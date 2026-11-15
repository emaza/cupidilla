import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { emailTokens, identities, sessions, users } from '../src/database/schema/index.js';
import { PasswordService } from '../src/users/password.service.js';
import { UnverifiedAccountsSweeper } from '../src/users/unverified-accounts.sweeper.js';
import { BETO, inbox, registerBeto, TEST_PASSWORD } from './helpers/mail.js';
import { runFlow } from './helpers/oauth.js';
import {
  api,
  countRows,
  createTestApp,
  resetRateLimits,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

/** QA de la fase B: huecos que no cubrían los tests del programador. */
describe('QA fase B', () => {
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
    inbox(t.app).clear();
    t.clock.set(TEST_NOW);
    vi.restoreAllMocks();
  });

  /** Con `agedTo`, la cuenta se envejece antes de crear el token pendiente (que no caduque antes). */
  const startLink = async (agedTo?: string) => {
    const { userId } = await registerBeto(t.app, t.db);
    if (agedTo) t.clock.set(agedTo);
    const flow = await runFlow(t.app, { identity: { email: BETO } });
    expect(flow.response.body.result).toBe('link_required');
    return { userId, pendingToken: flow.response.body.pending.token as string };
  };

  it('B3-12 (unión): contraseña cambiada entre la verificación y la unión → 403 PASSWORD_INCORRECT, sin sesión ni identidad ni verificar', async () => {
    const { pendingToken } = await startLink();
    const passwords = t.app.get(PasswordService);
    const verify = passwords.verify.bind(passwords);
    vi.spyOn(passwords, 'verify').mockImplementation(async (hash, password) => {
      const ok = await verify(hash, password);
      await t.db
        .update(users)
        .set({ passwordHash: await passwords.hash('otra frase larga distinta') })
        .where(eq(users.email, BETO));
      return ok;
    });
    const linked = await api(t.app)
      .post('/auth/oauth/link')
      .send({ pendingToken, email: BETO, password: TEST_PASSWORD });
    expect(linked.status).toBe(403);
    expect(linked.body.error.code).toBe('PASSWORD_INCORRECT');
    expect(await countRows(t.db, 'sessions')).toBe(0);
    expect(await t.db.select().from(identities)).toEqual([]);
    expect((await t.db.select().from(users))[0]?.emailVerifiedAt).toBeNull();
  });

  it('unión a la vez que el barrido del día 7: ningún 500 (interbloqueo) y resultado coherente', async () => {
    const sweeper = t.app.get(UnverifiedAccountsSweeper);
    const passwords = t.app.get(PasswordService);
    const verify = passwords.verify.bind(passwords);

    // Orden 1, controlado con una compuerta: el barrido corre mientras la unión está dentro de la
    // verificación de la contraseña. La cuenta (y con ella el token pendiente) desaparece y la
    // unión no puede completarse: 400, sin sesión ni identidad, nunca un 500.
    const { pendingToken } = await startLink('2026-11-18T10:00:00Z');
    let reached!: () => void;
    const inVerify = new Promise<void>((resolve) => (reached = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(passwords, 'verify').mockImplementation(async (hash, password) => {
      reached();
      await gate;
      return verify(hash, password);
    });
    const linking = api(t.app)
      .post('/auth/oauth/link')
      .send({ pendingToken, email: BETO, password: TEST_PASSWORD })
      .then((response) => response);
    try {
      await inVerify;
      expect((await sweeper.sweep()).deleted).toBe(1);
    } finally {
      release();
    }
    const swept = await linking;
    expect(swept.status).toBe(400);
    expect(swept.body.error.code).toBe('OAUTH_FLOW_INVALID');
    expect(await t.db.select().from(users)).toEqual([]);
    expect(await countRows(t.db, 'sessions')).toBe(0);
    expect(await t.db.select().from(identities)).toEqual([]);
    vi.restoreAllMocks();

    // Orden 2: la unión termina antes del barrido; la cuenta queda verificada y no se borra.
    await truncateAll(t.db);
    resetRateLimits(t.app);
    inbox(t.app).clear();
    t.clock.set(TEST_NOW);
    const second = await startLink('2026-11-18T10:00:00Z');
    const linked = await api(t.app)
      .post('/auth/oauth/link')
      .send({ pendingToken: second.pendingToken, email: BETO, password: TEST_PASSWORD });
    expect(linked.status).toBe(200);
    expect((await sweeper.sweep()).deleted).toBe(0);
    const [row] = await t.db.select().from(users);
    expect(row?.emailVerifiedAt).not.toBeNull();
  });

  it('unión con la cuenta verificada por otra petición tras la lectura inicial: la respuesta sale verificada', async () => {
    const { pendingToken } = await startLink();
    const passwords = t.app.get(PasswordService);
    const verify = passwords.verify.bind(passwords);
    vi.spyOn(passwords, 'verify').mockImplementation(async (hash, password) => {
      const ok = await verify(hash, password);
      // Otra petición (p. ej. la confirmación del enlace) verifica la cuenta ya leída como sin verificar.
      await t.db.update(users).set({ emailVerifiedAt: t.clock.now() }).where(eq(users.email, BETO));
      return ok;
    });
    const linked = await api(t.app)
      .post('/auth/oauth/link')
      .send({ pendingToken, email: BETO, password: TEST_PASSWORD });
    expect(linked.status).toBe(200);
    expect(linked.body.user.emailVerified).toBe(true);
  });

  it('8 contraseñas erróneas simultáneas: el enlace acaba anulado, nadie abre sesión y la correcta después da 400', async () => {
    const { link } = await registerBeto(t.app, t.db);
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        api(t.app)
          .post('/auth/email-verification')
          .send({ token: link, password: 'incorrecta incorrecta' }),
      ),
    );
    expect(responses.every((r) => [403, 400].includes(r.status))).toBe(true);
    expect(await t.db.select().from(emailTokens)).toEqual([]);
    const ok = await api(t.app)
      .post('/auth/email-verification')
      .send({ token: link, password: TEST_PASSWORD });
    expect(ok.status).toBe(400);
    expect(await t.db.select().from(sessions)).toEqual([]);
  });
});
