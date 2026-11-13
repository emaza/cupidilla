import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { users } from '../src/database/schema/index.js';
import { runFlow, signupBody } from './helpers/oauth.js';
import {
  api,
  createTestApp,
  TEST_NOW,
  truncateAll,
  uniqueIp,
  type TestApp,
} from './helpers/test-app.js';

describe('O-24: crear una contraseña (§9.5)', () => {
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
      token: created.body.session.token as string,
      userId: created.body.user.id as string,
    };
  }

  const PASSWORD = 'una frase larga nueva';

  it('sesión no reciente → 403 sin crear nada', async () => {
    const account = await googleAccount();
    t.clock.advanceMinutes(11);
    const response = await authed(account.token)
      .post('/users/me/password')
      .send({ password: PASSWORD });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('REAUTHENTICATION_REQUIRED');
    const [row] = await t.db.select().from(users);
    expect(row?.passwordHash).toBeNull();
  });

  it('9 caracteres → 400 too_short; 129 → too_long', async () => {
    const account = await googleAccount();
    const short = await authed(account.token)
      .post('/users/me/password')
      .send({ password: '123456789' });
    expect(short.status).toBe(400);
    expect(short.body.error.fields).toEqual([{ path: 'password', issue: 'too_short' }]);
    const long = await authed(account.token)
      .post('/users/me/password')
      .send({ password: 'x'.repeat(129) });
    expect(long.body.error.fields).toEqual([{ path: 'password', issue: 'too_long' }]);
  });

  it('correcta → 204 con hash argon2id; después, login con correo y contraseña y el borrado la pide', async () => {
    const account = await googleAccount();
    const response = await authed(account.token)
      .post('/users/me/password')
      .send({ password: PASSWORD });
    expect(response.status).toBe(204);
    const [row] = await t.db.select().from(users).where(eq(users.id, account.userId));
    expect(row?.passwordHash).toMatch(/^\$argon2id\$/);

    const login = await api(t.app)
      .post('/auth/login')
      .send({ email: account.email, password: PASSWORD });
    expect(login.status).toBe(200);

    const deletion = await authed(account.token).post('/users/me/deletion').send({});
    expect(deletion.status).toBe(400);
    expect(deletion.body.error.fields).toEqual([{ path: 'password', issue: 'required' }]);

    // Con contraseña ya se puede quitar el único proveedor.
    expect((await authed(account.token).post('/users/me/identities/google/removal')).status).toBe(
      204,
    );
  });

  it('segunda creación → 409 PASSWORD_ALREADY_SET; dos simultáneas → una 204 y otra 409', async () => {
    const account = await googleAccount();
    const both = await Promise.all([
      authed(account.token).post('/users/me/password').send({ password: PASSWORD }),
      authed(account.token)
        .post('/users/me/password')
        .send({ password: `${PASSWORD} otra` }),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([204, 409]);
    const again = await authed(account.token)
      .post('/users/me/password')
      .send({ password: PASSWORD });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('PASSWORD_ALREADY_SET');
  });

  it('el log no lleva la contraseña creada ni su hash', async () => {
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      output.push(String(chunk));
      return true;
    });
    const account = await googleAccount();
    await authed(account.token).post('/users/me/password').send({ password: PASSWORD });
    vi.restoreAllMocks();
    const log = output.join('');
    expect(log).toContain('password_created');
    expect(log).not.toContain(PASSWORD);
    expect(log).not.toContain('$argon2id$');
    expect(log).not.toContain(account.email);
  });
});
