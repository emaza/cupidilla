import { completeFakeAuthorization, type FakeIdentity } from '@cupidilla/fake-oauth-provider';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashOpaqueToken } from '../src/common/crypto/opaque-token.js';
import { oauthStates, sessions, users } from '../src/database/schema/index.js';
import { newIdentity, runFlow, signupBody } from './helpers/oauth.js';
import {
  api,
  countRows,
  createTestApp,
  registerUser,
  TEST_NOW,
  truncateAll,
  uniqueIp,
  type TestApp,
} from './helpers/test-app.js';

/**
 * O-24: crear una contraseña (§9.5). Desde la decisión 21 se confirma siempre con un proveedor
 * unido: el hash viaja en la fila de reautenticación y se guarda en `users` a la vuelta.
 */
describe('O-24: crear una contraseña con confirmación (§9.5, decisión 21)', () => {
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const authed = (token: string) => ({
    post: (path: string) =>
      api(t.app, uniqueIp()).post(path).set('Authorization', `Bearer ${token}`),
  });

  async function googleAccount() {
    const flow = await runFlow(t.app);
    const created = await api(t.app)
      .post('/auth/oauth/signup')
      .send(signupBody(flow.response.body.pending.token as string));
    return {
      email: flow.identity.email as string,
      subject: flow.identity.subject,
      token: created.body.session.token as string,
      userId: created.body.user.id as string,
    };
  }

  const PASSWORD = 'una frase larga nueva';

  const start = (token: string, body: object = { password: PASSWORD }, provider = 'google') =>
    authed(token)
      .post(`/users/me/oauth/${provider}/authorization`)
      .send({ purpose: 'create_password', returnPath: '/account/password', ...body });

  /** Pasa por el Google falso con `identity` y vuelve con el Bearer `token`. */
  async function confirm(
    token: string | null,
    started: { body: { flowToken: string; authorizationUrl: string } },
    identity: Partial<FakeIdentity> & { decision?: 'approve' | 'deny' },
  ) {
    const url = await completeFakeAuthorization(started.body.authorizationUrl, {
      ...newIdentity(identity),
      decision: identity.decision,
    });
    const body = { flowToken: started.body.flowToken, callbackQuery: url.search.slice(1) };
    const request = api(t.app, uniqueIp()).post('/auth/oauth/google/callback');
    if (token) request.set('Authorization', `Bearer ${token}`);
    return { response: await request.send(body), body };
  }

  const passwordHash = async (userId: string) => {
    const [row] = await t.db
      .select({ hash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId));
    return row?.hash ?? null;
  };

  for (const [name, minutes] of [
    ['sesión de hace 1 minuto', 1],
    ['sesión de hace 1 hora (ya no hay regla de 10 minutos)', 60],
  ] as const) {
    it(`${name} → 201 con la URL del Google unido; la contraseña aún no se guarda`, async () => {
      const account = await googleAccount();
      t.clock.advanceMinutes(minutes);
      const started = await start(account.token);
      expect(started.status).toBe(201);
      const url = new URL(started.body.authorizationUrl as string);
      expect(url.pathname).toMatch(/^\/google\//);
      expect(url.searchParams.get('login_hint')).toBe(account.email);
      const rows = await t.db.select().from(oauthStates);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        provider: 'google',
        purpose: 'reauthenticate',
        connectProvider: null,
        sessionTokenHash: hashOpaqueToken(account.token),
        returnPath: '/account/password',
      });
      expect(rows[0]?.newPasswordHash).toMatch(/^\$argon2id\$/);
      expect(await passwordHash(account.userId)).toBeNull();
    });
  }

  it('confirmada → password_created con hash argon2id; después, login y el borrado la pide', async () => {
    const account = await googleAccount();
    t.clock.advanceMinutes(30);
    const started = await start(account.token);
    const [state] = await t.db.select().from(oauthStates);
    const { response } = await confirm(account.token, started, { subject: account.subject });
    expect(response.body).toEqual({ result: 'password_created' });
    expect(await passwordHash(account.userId)).toBe(state?.newPasswordHash);
    expect(await countRows(t.db, 'oauth_states')).toBe(0);
    const [session] = await t.db
      .select({ at: sessions.authenticatedAt })
      .from(sessions)
      .where(eq(sessions.tokenHash, hashOpaqueToken(account.token)));
    expect(session?.at.toISOString()).toBe(t.clock.now().toISOString());

    const login = await api(t.app)
      .post('/auth/login')
      .send({ email: account.email, password: PASSWORD });
    expect(login.status).toBe(200);

    const deletion = await authed(account.token).post('/users/me/deletion').send({});
    expect(deletion.status).toBe(400);
    expect(deletion.body.error.fields).toEqual([{ path: 'password', issue: 'required' }]);

    // Con contraseña ya se puede quitar el único proveedor, escribiéndola (decisión 20).
    const removed = await authed(account.token)
      .post('/users/me/identities/google/removal')
      .send({ password: PASSWORD });
    expect(removed.status).toBe(204);
  });

  it('reutilizar el flowToken → OAUTH_FLOW_INVALID', async () => {
    const account = await googleAccount();
    const started = await start(account.token);
    const { response, body } = await confirm(account.token, started, {
      subject: account.subject,
    });
    expect(response.body).toEqual({ result: 'password_created' });
    const again = await authed(account.token).post('/auth/oauth/google/callback').send(body);
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('OAUTH_FLOW_INVALID');
  });

  it('la vuelta con el Bearer de otra sesión, o tras cerrar la sesión → OAUTH_FLOW_INVALID', async () => {
    const account = await googleAccount();
    const signIn = await runFlow(t.app, {
      identity: { subject: account.subject, email: account.email },
    });
    expect(signIn.response.body.result).toBe('signed_in');
    const otherToken = signIn.response.body.session.token as string;

    const started = await start(account.token);
    const fromOther = await confirm(otherToken, started, { subject: account.subject });
    expect(fromOther.response.status).toBe(400);
    expect(fromOther.response.body.error.code).toBe('OAUTH_FLOW_INVALID');

    const startedAgain = await start(account.token);
    expect((await authed(account.token).post('/auth/logout')).status).toBe(204);
    expect(await countRows(t.db, 'oauth_states')).toBe(0);
    const afterLogout = await confirm(account.token, startedAgain, { subject: account.subject });
    expect(afterLogout.response.status).toBe(400);
    expect(await passwordHash(account.userId)).toBeNull();
  });

  it('la confirmación caduca a los 10 minutos justos', async () => {
    const account = await googleAccount();
    const started = await start(account.token);
    t.clock.advanceMinutes(10);
    const late = await confirm(account.token, started, { subject: account.subject });
    expect(late.response.status).toBe(400);
    expect(late.response.body.error.code).toBe('OAUTH_FLOW_INVALID');
    expect(await passwordHash(account.userId)).toBeNull();

    const startedAgain = await start(account.token);
    t.clock.advanceMinutes(9 + 59 / 60);
    const inTime = await confirm(account.token, startedAgain, { subject: account.subject });
    expect(inTime.response.body).toEqual({ result: 'password_created' });
  });

  it('con otro subject → identity_mismatch y no se crea nada', async () => {
    const account = await googleAccount();
    const started = await start(account.token);
    const { response } = await confirm(account.token, started, {});
    expect(response.body).toEqual({
      result: 'failed',
      reason: 'identity_mismatch',
      entryPoint: 'account',
      returnPath: '/account/password',
    });
    expect(await passwordHash(account.userId)).toBeNull();
  });

  it('cancelar en Google → cancelled y no se crea nada', async () => {
    const account = await googleAccount();
    const started = await start(account.token);
    const { response } = await confirm(account.token, started, {
      subject: account.subject,
      decision: 'deny',
    });
    expect(response.body).toMatchObject({ result: 'failed', reason: 'cancelled' });
    expect(await passwordHash(account.userId)).toBeNull();
    expect(await countRows(t.db, 'oauth_states')).toBe(0);
  });

  it('9 caracteres → 400 too_short; 129 → too_long; sin escribir nada en oauth_states', async () => {
    const account = await googleAccount();
    const short = await start(account.token, { password: '123456789' });
    expect(short.status).toBe(400);
    expect(short.body.error.fields).toEqual([{ path: 'password', issue: 'too_short' }]);
    const long = await start(account.token, { password: 'x'.repeat(129) });
    expect(long.body.error.fields).toEqual([{ path: 'password', issue: 'too_long' }]);
    const missing = await start(account.token, { password: undefined });
    expect(missing.body.error.fields).toEqual([{ path: 'password', issue: 'required' }]);
    expect(await countRows(t.db, 'oauth_states')).toBe(0);
  });

  it('cuenta con contraseña → 409 PASSWORD_ALREADY_SET; proveedor no unido → 404', async () => {
    const user = await registerUser(t.app);
    const withPassword = await start(user.token);
    expect(withPassword.status).toBe(409);
    expect(withPassword.body.error.code).toBe('PASSWORD_ALREADY_SET');

    const account = await googleAccount();
    const notLinked = await start(account.token, { password: PASSWORD }, 'facebook');
    expect(notLinked.status).toBe(404);
    expect(await countRows(t.db, 'oauth_states')).toBe(0);
  });

  it('dos confirmaciones a la vez → una password_created y otra password_already_set', async () => {
    const account = await googleAccount();
    const first = await start(account.token);
    const second = await start(account.token, { password: `${PASSWORD} otra` });
    const both = await Promise.all([
      confirm(account.token, first, { subject: account.subject }),
      confirm(account.token, second, { subject: account.subject }),
    ]);
    const results = both.map(({ response }) => response.body.result ?? response.body.reason);
    expect(results.sort()).toEqual(['failed', 'password_created']);
    expect(both.map(({ response }) => response.body.reason).filter(Boolean)).toEqual([
      'password_already_set',
    ]);
  });

  it('POST /users/me/password ya no existe', async () => {
    const account = await googleAccount();
    const response = await authed(account.token)
      .post('/users/me/password')
      .send({ password: PASSWORD });
    expect(response.status).toBe(404);
    expect(await passwordHash(account.userId)).toBeNull();
  });

  it('el log no lleva la contraseña creada ni su hash', async () => {
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      output.push(String(chunk));
      return true;
    });
    const account = await googleAccount();
    const started = await start(account.token);
    await confirm(account.token, started, { subject: account.subject });
    vi.restoreAllMocks();
    const log = output.join('');
    expect(log).toContain('password_created');
    expect(log).not.toContain(PASSWORD);
    expect(log).not.toContain('$argon2id$');
    expect(log).not.toContain(account.email);
  });
});
