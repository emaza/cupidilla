import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { lockEmail } from '../src/database/email-lock.js';
import { identities, pendingIdentities } from '../src/database/schema/index.js';
import { Transactions } from '../src/database/transactions.js';
import { IdentitiesService } from '../src/oauth/identities.service.js';
import { runFlow, signupBody } from './helpers/oauth.js';
import {
  api,
  countRows,
  createTestApp,
  registerBody,
  registerUser,
  resetRateLimits,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';
import { emailOutbox } from '../src/database/schema/index.js';

/** Espera a que alguna sesión esté bloqueada esperando un advisory lock. */
async function waitForAdvisoryWaiter(t: TestApp): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    const result = await t.db.execute<{ count: string }>(
      sql`select count(*)::text as count from pg_locks where locktype = 'advisory' and not granted`,
    );
    if (Number(result.rows[0]?.count) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Nadie esperó el bloqueo del correo');
}

/**
 * R7b: no se crea una cuenta con un correo que ya es el `provider_email` de una identidad de otra
 * cuenta. Con el registro uniforme (correo §5.1), la respuesta es el mismo 202 que con un correo
 * nuevo o con `users.email` repetido, y solo se avisa al dueño.
 */
describe('Alta con contraseña de un correo de proveedor ya registrado (R7b)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await truncateAll(t.db);
    resetRateLimits(t.app);
    t.clock.set(TEST_NOW);
  });

  const outboxKinds = async () =>
    (await t.db.select().from(emailOutbox)).map((row) => `${row.kind}:${row.toEmail}`).sort();

  /** Cuenta A con Facebook unido, cuyo correo de proveedor no es el de la cuenta. */
  async function accountWithFacebook(
    providerEmail: string | null,
    { provider = 'facebook', emailVerified = true } = {},
  ): Promise<string> {
    const owner = await registerUser(t.app, { email: 'fenix@example.com' });
    await t.db.insert(identities).values({
      userId: owner.userId,
      provider: provider as 'google' | 'facebook',
      subject: `${provider}-sub-1`,
      providerEmail,
      emailVerified,
      createdAt: t.clock.now(),
      lastUsedAt: t.clock.now(),
    });
    return owner.userId;
  }

  it('R7b-1: el correo es provider_email de otra cuenta → el mismo 202 y solo un aviso', async () => {
    await accountWithFacebook('ecom@example.com');
    const fromIdentity = await api(t.app)
      .post('/auth/register')
      .send(registerBody({ email: 'ecom@example.com' }));
    const fromUsers = await api(t.app)
      .post('/auth/register')
      .send(registerBody({ email: 'fenix@example.com' }));

    expect(fromIdentity.status).toBe(202);
    // Indistinguible del correo repetido en users: no revela que viene de un proveedor.
    expect(fromIdentity.status).toBe(fromUsers.status);
    expect(fromIdentity.text).toBe(fromUsers.text);
    expect(await outboxKinds()).toEqual([
      'signup_notice:ecom@example.com',
      'signup_notice:fenix@example.com',
    ]);
    expect(await countRows(t.db, 'users')).toBe(1);
    expect(await countRows(t.db, 'sessions')).toBe(1);
    expect(await countRows(t.db, 'consents')).toBe(1);
  });

  it('R7b-2: con otras mayúsculas y espacios, en la petición o en la fila guardada', async () => {
    await accountWithFacebook(' Ecom@Example.COM ');
    for (const email of ['ecom@example.com', '  ECOM@example.com ']) {
      const response = await api(t.app).post('/auth/register').send(registerBody({ email }));
      expect(response.status).toBe(202);
    }
    expect(await countRows(t.db, 'users')).toBe(1);
    expect(await outboxKinds()).toEqual(['signup_notice:ecom@example.com']);
  });

  it('R7b-3: otros correos se siguen registrando; un provider_email NULL no bloquea nada', async () => {
    await accountWithFacebook(null);
    const response = await api(t.app)
      .post('/auth/register')
      .send(registerBody({ email: 'otra@example.com' }));
    expect(response.status).toBe(202);
    expect(await countRows(t.db, 'users')).toBe(2);
  });

  it('3 (decisión 21): una identidad antigua con ese correo sin verificar no bloquea el alta', async () => {
    await accountWithFacebook('x@gmail.com', { provider: 'google', emailVerified: false });
    const response = await api(t.app)
      .post('/auth/register')
      .send(registerBody({ email: 'x@gmail.com' }));
    expect(response.status).toBe(202);
    expect(await countRows(t.db, 'users')).toBe(2);
  });

  it('4 (decisión 21): un Google verificado con ese correo → el mismo 202, sin cuenta nueva', async () => {
    await accountWithFacebook('x@gmail.com', { provider: 'google' });
    const fromIdentity = await api(t.app)
      .post('/auth/register')
      .send(registerBody({ email: 'x@gmail.com' }));
    const fromUsers = await api(t.app)
      .post('/auth/register')
      .send(registerBody({ email: 'fenix@example.com' }));
    expect(fromIdentity.status).toBe(202);
    expect(fromIdentity.text).toEqual(fromUsers.text);
    expect(await countRows(t.db, 'users')).toBe(1);
    expect(await countRows(t.db, 'sessions')).toBe(1);
    expect(await countRows(t.db, 'consents')).toBe(1);
  });

  it('R7b-4: un alta espera a la identidad que se está creando con ese correo y la ve', async () => {
    const ownerId = await accountWithFacebook(null);
    const transactions = t.app.get(Transactions);
    let registration: Promise<{ status: number; body: { error?: { code: string } } }> | undefined;

    await transactions.run(async (tx) => {
      await lockEmail(tx, 'nuevo@example.com');
      registration = api(t.app)
        .post('/auth/register')
        .send(registerBody({ email: 'NUEVO@example.com' }))
        .then((response) => response);
      // El alta no puede avanzar mientras esta transacción tenga el bloqueo del correo.
      await waitForAdvisoryWaiter(t);
      await tx.insert(identities).values({
        userId: ownerId,
        provider: 'google',
        subject: 'google-sub-1',
        providerEmail: 'nuevo@example.com',
        emailVerified: true,
        createdAt: t.clock.now(),
        lastUsedAt: t.clock.now(),
      });
    });

    const response = await registration!;
    expect(response.status).toBe(202);
    expect(await countRows(t.db, 'users')).toBe(1);
    expect(await outboxKinds()).toEqual(['signup_notice:nuevo@example.com']);
  });

  it('R7b-5: crear una identidad espera al alta en curso de su correo', async () => {
    const ownerId = await accountWithFacebook(null);
    const transactions = t.app.get(Transactions);
    const identitiesService = t.app.get(IdentitiesService);
    let creation: Promise<void> | undefined;
    let created = false;

    await transactions.run(async (tx) => {
      await lockEmail(tx, 'nuevo@example.com');
      creation = identitiesService
        .createForConnect(ownerId, {
          provider: 'google',
          subject: 'google-sub-2',
          providerEmail: 'nuevo@example.com',
          emailVerified: true,
        })
        .then(() => {
          created = true;
        });
      await waitForAdvisoryWaiter(t);
      expect(created).toBe(false);
    });

    await creation;
    expect(created).toBe(true);
    expect(await countRows(t.db, 'identities')).toBe(2);
  });
});

/**
 * R7b, alta con un proveedor: si el correo es el `provider_email` de una identidad de otra cuenta,
 * siempre `use_other_provider` con los proveedores de esa cuenta, tenga o no contraseña.
 */
describe('Alta con Google de un correo de proveedor ya registrado (R7b)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await truncateAll(t.db);
    t.clock.set(TEST_NOW);
  });

  const signup = (token: string) => api(t.app).post('/auth/oauth/signup').send(signupBody(token));

  async function addFacebook(userId: string, providerEmail: string, subject = 'facebook-sub-1') {
    await t.db.insert(identities).values({
      userId,
      provider: 'facebook',
      subject,
      providerEmail,
      emailVerified: true,
      createdAt: t.clock.now(),
      lastUsedAt: t.clock.now(),
    });
  }

  /** Cuenta sin contraseña creada con Google (fenix@…), como la cuenta A del problema. */
  async function googleAccount(email = 'fenix@example.com'): Promise<string> {
    const flow = await runFlow(t.app, { entryPoint: 'register', identity: { email } });
    expect(flow.response.body.result).toBe('signup_required');
    const response = await signup(flow.response.body.pending.token as string);
    expect(response.status).toBe(201);
    return response.body.user.id as string;
  }

  async function untilSignup(email: string): Promise<string> {
    const flow = await runFlow(t.app, { entryPoint: 'register', identity: { email } });
    expect(flow.response.body.result).toBe('signup_required');
    return flow.response.body.pending.token as string;
  }

  it('R7b-6: cuenta sin contraseña con Facebook de ese correo → use_other_provider', async () => {
    const ownerId = await googleAccount();
    await addFacebook(ownerId, 'ecom@example.com');
    const flow = await runFlow(t.app, {
      entryPoint: 'register',
      identity: { email: 'ecom@example.com' },
    });
    expect(flow.response.body).toEqual({
      result: 'use_other_provider',
      providers: ['google', 'facebook'],
    });
    expect(await countRows(t.db, 'users')).toBe(1);
    expect(await countRows(t.db, 'identities')).toBe(2);
    expect(await countRows(t.db, 'pending_identities')).toBe(0);
  });

  it('R7b-7: cuenta con contraseña también → use_other_provider, sin unión pendiente', async () => {
    const owner = await registerUser(t.app, { email: 'fenix@example.com' });
    await addFacebook(owner.userId, 'ecom@example.com');
    const flow = await runFlow(t.app, { identity: { email: 'ecom@example.com' } });
    expect(flow.response.body).toEqual({ result: 'use_other_provider', providers: ['facebook'] });
    expect(await countRows(t.db, 'pending_identities')).toBe(0);
  });

  it('R7b-8: con mayúsculas y espacios en la fila guardada y mayúsculas del proveedor', async () => {
    const ownerId = await googleAccount();
    await addFacebook(ownerId, '  Ecom@Example.COM ');
    const flow = await runFlow(t.app, { identity: { email: 'ECOM@example.com' } });
    expect(flow.response.body).toEqual({
      result: 'use_other_provider',
      providers: ['google', 'facebook'],
    });
  });

  it('R7b-9: gana users.email; si no, la identidad usada más recientemente', async () => {
    const withPassword = await registerUser(t.app, { email: 'ecom@example.com' });
    const other = await googleAccount();
    await addFacebook(other, 'ecom@example.com');
    const linked = await runFlow(t.app, { identity: { email: 'ecom@example.com' } });
    expect(linked.response.body.result).toBe('link_required');
    const [row] = await t.db.select().from(pendingIdentities);
    expect(row).toMatchObject({ kind: 'link', userId: withPassword.userId });

    await truncateAll(t.db);
    const older = await registerUser(t.app, { email: 'a@example.com' });
    await addFacebook(older.userId, 'dup@example.com', 'facebook-sub-a');
    t.clock.advanceMinutes(5);
    const newer = await googleAccount('b@example.com');
    await addFacebook(newer, 'dup@example.com', 'facebook-sub-b');
    const flow = await runFlow(t.app, { identity: { email: 'dup@example.com' } });
    expect(flow.response.body).toEqual({
      result: 'use_other_provider',
      providers: ['google', 'facebook'],
    });
  });

  it('5b (decisión 21): una identidad con ese correo sin verificar no cuenta → signup_required', async () => {
    const ownerId = await googleAccount();
    await t.db.insert(identities).values({
      userId: ownerId,
      provider: 'facebook',
      subject: 'facebook-sub-1',
      providerEmail: 'ecom@example.com',
      emailVerified: false,
      createdAt: t.clock.now(),
      lastUsedAt: t.clock.now(),
    });
    const flow = await runFlow(t.app, {
      entryPoint: 'register',
      identity: { email: 'ecom@example.com' },
    });
    expect(flow.response.body.result).toBe('signup_required');
    expect((await signup(flow.response.body.pending.token as string)).status).toBe(201);
  });

  it('R7b-10: otros correos siguen dando signup_required y el alta se completa', async () => {
    const ownerId = await googleAccount();
    await addFacebook(ownerId, 'ecom@example.com');
    const token = await untilSignup('nueva@example.com');
    expect((await signup(token)).status).toBe(201);
  });

  describe('carrera con POST /auth/oauth/signup', () => {
    for (const withPassword of [false, true]) {
      it(`R7b-11: el correo pasa a ser de un proveedor de otra cuenta ${withPassword ? 'con' : 'sin'} contraseña → 409 ACCOUNT_USES_OTHER_PROVIDER`, async () => {
        const token = await untilSignup('Ecom@example.com');
        const ownerId = withPassword
          ? (await registerUser(t.app, { email: 'fenix@example.com' })).userId
          : await googleAccount();
        await addFacebook(ownerId, 'ecom@example.com');

        const response = await signup(token);
        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('ACCOUNT_USES_OTHER_PROVIDER');
        expect(await countRows(t.db, 'users')).toBe(1);
        expect(await countRows(t.db, 'identities')).toBe(withPassword ? 1 : 2);
        expect(await countRows(t.db, 'pending_identities')).toBe(0);
      });
    }

    it('R7b-12: el alta espera a la identidad que se está creando con ese correo y la ve', async () => {
      const token = await untilSignup('ecom@example.com');
      const ownerId = await googleAccount();
      const transactions = t.app.get(Transactions);
      let completion: Promise<{ status: number; body: { error?: { code: string } } }> | undefined;

      await transactions.run(async (tx) => {
        await lockEmail(tx, 'ecom@example.com');
        completion = signup(token).then((response) => response);
        await waitForAdvisoryWaiter(t);
        await tx.insert(identities).values({
          userId: ownerId,
          provider: 'facebook',
          subject: 'facebook-sub-1',
          providerEmail: 'ecom@example.com',
          emailVerified: true,
          createdAt: t.clock.now(),
          lastUsedAt: t.clock.now(),
        });
      });

      const response = await completion!;
      expect(response.status).toBe(409);
      expect(response.body.error?.code).toBe('ACCOUNT_USES_OTHER_PROVIDER');
      expect(await countRows(t.db, 'users')).toBe(1);
    });
  });
});
