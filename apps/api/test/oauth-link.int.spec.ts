import { oauthAuthResponseSchema, type OAuthProvider } from '@cupidilla/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashOpaqueToken } from '../src/common/crypto/opaque-token.js';
import { identities, pendingIdentities, sessions } from '../src/database/schema/index.js';
import { PasswordService } from '../src/users/password.service.js';
import { runFlow } from './helpers/oauth.js';
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

describe('Unión con una cuenta de correo y contraseña (fase 4)', () => {
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

  /** Cuenta con contraseña y una unión pendiente con su correo. */
  async function pendingLink(provider: OAuthProvider = 'google', returnPath?: string) {
    const account = await registerUser(t.app);
    const flow = await runFlow(t.app, {
      provider,
      returnPath,
      identity: { email: account.email },
    });
    expect(flow.response.body.result).toBe('link_required');
    return { account, flow, token: flow.response.body.pending.token as string };
  }

  const link = (body: Record<string, unknown>, ip = uniqueIp()) =>
    api(t.app, ip).post('/auth/oauth/link').send(body);

  it('O-7: contraseña correcta → 200, identidad unida y sesión; la próxima vez, entrada directa', async () => {
    const { account, flow, token } = await pendingLink('google', '/account/delete');
    const response = await link({
      pendingToken: token,
      email: account.email,
      password: account.password,
    });
    expect(response.status).toBe(200);
    const body = oauthAuthResponseSchema.parse(response.body);
    expect(body.user.id).toBe(account.userId);
    expect(body.returnPath).toBe('/account/delete');

    const [identity] = await t.db.select().from(identities);
    expect(identity).toMatchObject({
      userId: account.userId,
      provider: 'google',
      subject: flow.identity.subject,
    });
    const [session] = await t.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, hashOpaqueToken(body.session.token)));
    expect(session?.authenticatedAt.toISOString()).toBe(session?.createdAt.toISOString());
    expect(await countRows(t.db, 'pending_identities')).toBe(0);

    const again = await runFlow(t.app, {
      identity: { subject: flow.identity.subject, email: account.email },
    });
    expect(again.response.body.result).toBe('signed_in');
    // Y con la contraseña sigue entrando.
    expect(
      (
        await api(t.app)
          .post('/auth/login')
          .send({ email: account.email, password: account.password })
      ).status,
    ).toBe(200);
  });

  it('O-7: 4 fallos → 403 PASSWORD_INCORRECT y la fila sigue; el 5.º → LINK_ATTEMPTS_EXCEEDED y la fila se borra', async () => {
    const { account, token } = await pendingLink();
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await link({
        pendingToken: token,
        email: account.email,
        password: 'contraseña-mala-x',
      });
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('PASSWORD_INCORRECT');
      const [row] = await t.db.select().from(pendingIdentities);
      expect(row?.failedAttempts).toBe(attempt);
    }
    const fifth = await link({
      pendingToken: token,
      email: account.email,
      password: 'contraseña-mala-x',
    });
    expect(fifth.status).toBe(403);
    expect(fifth.body.error.code).toBe('LINK_ATTEMPTS_EXCEEDED');
    expect(await countRows(t.db, 'pending_identities')).toBe(0);
    expect(await countRows(t.db, 'identities')).toBe(0);
  });

  it('carrera en el 5.º fallo: con 4 acumulados, dos a la vez dan LINK_ATTEMPTS_EXCEEDED y OAUTH_FLOW_INVALID, sin 500', async () => {
    const { account, token } = await pendingLink();
    await t.db
      .update(pendingIdentities)
      .set({ failedAttempts: 4 })
      .where(eq(pendingIdentities.tokenHash, hashOpaqueToken(token)));
    const body = { pendingToken: token, email: account.email, password: 'contraseña-mala-x' };
    const responses = await Promise.all([link(body), link(body)]);
    expect(responses.map((r) => r.body.error.code).sort()).toEqual([
      'LINK_ATTEMPTS_EXCEEDED',
      'OAUTH_FLOW_INVALID',
    ]);
    expect(await countRows(t.db, 'pending_identities')).toBe(0);
  });

  it('O-8: el cubo por correo es el de /auth/login: 3 logins y 2 uniones fallidas → el siguiente da 429', async () => {
    const { account, token } = await pendingLink();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await api(t.app, uniqueIp())
        .post('/auth/login')
        .send({ email: account.email, password: 'contraseña-mala-x' });
      expect(response.status).toBe(401);
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await link({
        pendingToken: token,
        email: account.email,
        password: 'contraseña-mala-x',
      });
      expect(response.status).toBe(403);
    }
    const blockedLink = await link({
      pendingToken: token,
      email: account.email,
      password: account.password,
    });
    expect(blockedLink.status).toBe(429);
    expect(blockedLink.headers['retry-after']).toBeDefined();
    const blockedLogin = await api(t.app, uniqueIp())
      .post('/auth/login')
      .send({ email: account.email, password: account.password });
    expect(blockedLogin.status).toBe(429);
    expect(await countRows(t.db, 'identities')).toBe(0);
  });

  it('O-9: un email distinto del de la cuenta → OAUTH_FLOW_INVALID sin verificar la contraseña', async () => {
    const { account, token } = await pendingLink();
    const verify = vi.spyOn(t.app.get(PasswordService), 'verify');
    const response = await link({
      pendingToken: token,
      email: 'otra@example.com',
      password: account.password,
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('OAUTH_FLOW_INVALID');
    expect(verify).not.toHaveBeenCalled();
    const [row] = await t.db.select().from(pendingIdentities);
    expect(row?.failedAttempts).toBe(0);
  });

  it('O-11 (unión): con Facebook también se une con la contraseña', async () => {
    const { account, token } = await pendingLink('facebook');
    const response = await link({
      pendingToken: token,
      email: account.email,
      password: account.password,
    });
    expect(response.status).toBe(200);
    const [identity] = await t.db.select().from(identities);
    expect(identity?.provider).toBe('facebook');
  });

  it('un pendiente de alta, caducado o inventado no sirve para unir', async () => {
    const signup = await runFlow(t.app);
    const asSignup = await link({
      pendingToken: signup.response.body.pending.token,
      email: signup.identity.email,
      password: 'lo-que-sea-1',
    });
    expect(asSignup.body.error.code).toBe('OAUTH_FLOW_INVALID');

    const { account, token } = await pendingLink();
    t.clock.advanceMinutes(31);
    const expired = await link({
      pendingToken: token,
      email: account.email,
      password: account.password,
    });
    expect(expired.body.error.code).toBe('OAUTH_FLOW_INVALID');

    const invented = await link({
      pendingToken: 'x'.repeat(43),
      email: account.email,
      password: account.password,
    });
    expect(invented.body.error.code).toBe('OAUTH_FLOW_INVALID');
    expect(await countRows(t.db, 'identities')).toBe(0);
  });

  it('la identidad se unió entre medias desde otra pestaña → OAUTH_FLOW_INVALID y la fila se borra', async () => {
    const { account, flow, token } = await pendingLink();
    const other = await runFlow(t.app, {
      identity: { subject: flow.identity.subject, email: account.email },
    });
    const otherToken = other.response.body.pending.token as string;
    expect(
      (await link({ pendingToken: otherToken, email: account.email, password: account.password }))
        .status,
    ).toBe(200);
    const response = await link({
      pendingToken: token,
      email: account.email,
      password: account.password,
    });
    expect(response.body.error.code).toBe('OAUTH_FLOW_INVALID');
    expect(await countRows(t.db, 'pending_identities')).toBe(0);
    expect(await countRows(t.db, 'identities')).toBe(1);
  });

  it('el log de la unión no lleva la contraseña, el token pendiente ni el correo', async () => {
    const output: string[] = [];
    const capture = (chunk: unknown): boolean => {
      output.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(capture);
    const { account, token } = await pendingLink();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await link({
        pendingToken: token,
        email: account.email,
        password: 'contraseña-mala-secreta',
      });
    }
    vi.restoreAllMocks();
    const log = output.join('');
    expect(log).toContain('oauth_link_locked');
    for (const value of [token, account.email, account.password, 'contraseña-mala-secreta']) {
      expect(log).not.toContain(value);
    }
  });
});
