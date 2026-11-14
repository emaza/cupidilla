import type { OAuthProvider } from '@cupidilla/contracts';
import { completeFakeAuthorization } from '@cupidilla/fake-oauth-provider';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashOpaqueToken } from '../src/common/crypto/opaque-token.js';
import { identities, sessions, users } from '../src/database/schema/index.js';
import { PROVIDER_CLIENTS, type ProviderClients } from '../src/oauth/providers/provider-clients.js';
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
 * Revocación concurrente: la sesión se cierra mientras el usuario está en el proveedor, después
 * de que la vuelta haya consumido la fila del flujo y antes de escribir nada. Ni la contraseña, ni
 * la identidad, ni la fila `connect` se crean.
 */
describe('vuelta con sesión: la sesión se cierra durante el intercambio con el proveedor', () => {
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

  async function providerAccount(provider: OAuthProvider) {
    const flow = await runFlow(t.app, { provider });
    const created = await api(t.app)
      .post('/auth/oauth/signup')
      .send(signupBody(flow.response.body.pending.token as string));
    expect(created.status).toBe(201);
    return {
      subject: flow.identity.subject,
      token: created.body.session.token as string,
      userId: created.body.user.id as string,
    };
  }

  /** Ejecuta `revoke` justo después del intercambio real con el proveedor falso. */
  function revokeDuringExchange(provider: OAuthProvider, revoke: () => Promise<unknown>) {
    const client = t.app.get<ProviderClients>(PROVIDER_CLIENTS).get(provider);
    if (!client) throw new Error(`Sin cliente ${provider}`);
    const original = client.exchange.bind(client);
    vi.spyOn(client, 'exchange').mockImplementation(async (input) => {
      const identity = await original(input);
      await revoke();
      return identity;
    });
  }

  const deleteSession = (token: string) => () =>
    t.db.delete(sessions).where(eq(sessions.tokenHash, hashOpaqueToken(token)));
  const expireSession = (token: string) => () =>
    t.db
      .update(sessions)
      .set({ expiresAt: t.clock.now() })
      .where(eq(sessions.tokenHash, hashOpaqueToken(token)));

  async function callback(
    token: string,
    provider: OAuthProvider,
    started: { flowToken: string; authorizationUrl: string },
    identity: { subject?: string; email?: string } = {},
  ) {
    const url = await completeFakeAuthorization(started.authorizationUrl, newIdentity(identity));
    return authed(token)
      .post(`/auth/oauth/${provider}/callback`)
      .send({ flowToken: started.flowToken, callbackQuery: url.search.slice(1) });
  }

  const passwordHash = async (userId: string) => {
    const [row] = await t.db
      .select({ hash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId));
    return row?.hash ?? null;
  };

  for (const [name, revoke] of [
    ['borrada', deleteSession],
    ['caducada', expireSession],
  ] as const) {
    it(`crear contraseña con la sesión ${name} → OAUTH_FLOW_INVALID y password_hash sigue NULL`, async () => {
      const account = await providerAccount('google');
      const started = await authed(account.token)
        .post('/users/me/oauth/google/authorization')
        .send({ purpose: 'create_password', password: 'una frase larga nueva' });
      expect(started.status).toBe(201);
      revokeDuringExchange('google', revoke(account.token));
      const response = await callback(account.token, 'google', started.body, {
        subject: account.subject,
      });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('OAUTH_FLOW_INVALID');
      expect(await passwordHash(account.userId)).toBeNull();
    });
  }

  it('confirmar «Añadir Google» con la sesión cerrada → OAUTH_FLOW_INVALID y ninguna fila connect', async () => {
    const account = await providerAccount('facebook');
    const started = await authed(account.token)
      .post('/users/me/oauth/google/authorization')
      .send({ purpose: 'connect', returnPath: '/account' });
    expect(started.status).toBe(201);
    revokeDuringExchange('facebook', deleteSession(account.token));
    const response = await callback(account.token, 'facebook', started.body, {
      subject: account.subject,
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('OAUTH_FLOW_INVALID');
    expect(await countRows(t.db, 'oauth_states')).toBe(0);
    expect(await countRows(t.db, 'identities')).toBe(1);
  });

  it('completar «Añadir Google» tras confirmar con la sesión cerrada → no se une', async () => {
    const account = await providerAccount('facebook');
    const started = await authed(account.token)
      .post('/users/me/oauth/google/authorization')
      .send({ purpose: 'connect', returnPath: '/account' });
    const confirmed = await callback(account.token, 'facebook', started.body, {
      subject: account.subject,
    });
    expect(confirmed.body.result).toBe('connect_confirmed');
    revokeDuringExchange('google', deleteSession(account.token));
    const response = await callback(account.token, 'google', confirmed.body.next);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('OAUTH_FLOW_INVALID');
    const linked = await t.db
      .select({ provider: identities.provider })
      .from(identities)
      .where(eq(identities.userId, account.userId));
    expect(linked.map((row) => row.provider)).toEqual(['facebook']);
  });

  it('añadir Facebook a una cuenta con contraseña con la sesión cerrada → no se une', async () => {
    const user = await registerUser(t.app);
    const started = await authed(user.token)
      .post('/users/me/oauth/facebook/authorization')
      .send({ purpose: 'connect', password: user.password });
    expect(started.status).toBe(201);
    revokeDuringExchange('facebook', deleteSession(user.token));
    const response = await callback(user.token, 'facebook', started.body, { email: user.email });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('OAUTH_FLOW_INVALID');
    expect(await countRows(t.db, 'identities')).toBe(0);
  });

  it('añadir Facebook mientras se borra la cuenta → OAUTH_FLOW_INVALID y no queda nada', async () => {
    const user = await registerUser(t.app);
    const started = await authed(user.token)
      .post('/users/me/oauth/facebook/authorization')
      .send({ purpose: 'connect', password: user.password });
    revokeDuringExchange('facebook', () => t.db.delete(users).where(eq(users.id, user.userId)));
    const response = await callback(user.token, 'facebook', started.body, { email: user.email });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('OAUTH_FLOW_INVALID');
    expect(await countRows(t.db, 'users')).toBe(0);
    expect(await countRows(t.db, 'identities')).toBe(0);
  });
});
