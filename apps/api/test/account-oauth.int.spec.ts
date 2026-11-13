import type { OAuthProvider } from '@cupidilla/contracts';
import { completeFakeAuthorization, type FakeIdentity } from '@cupidilla/fake-oauth-provider';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashOpaqueToken } from '../src/common/crypto/opaque-token.js';
import { identities, sessions, users } from '../src/database/schema/index.js';
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

describe('/account: reautenticar, añadir y quitar proveedores (fase 5)', () => {
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

  const authed = (token: string, ip = uniqueIp()) => {
    const client = api(t.app, ip);
    return {
      get: (path: string) => client.get(path).set('Authorization', `Bearer ${token}`),
      post: (path: string) => client.post(path).set('Authorization', `Bearer ${token}`),
    };
  };

  /** Cuenta creada con un proveedor (sin contraseña). */
  async function providerAccount(provider: OAuthProvider = 'google') {
    const flow = await runFlow(t.app, { provider });
    const created = await api(t.app)
      .post('/auth/oauth/signup')
      .send(signupBody(flow.response.body.pending.token as string));
    expect(created.status).toBe(201);
    return {
      identity: flow.identity,
      token: created.body.session.token as string,
      userId: created.body.user.id as string,
    };
  }

  /** Flujo con sesión: empieza, pasa por el proveedor falso y vuelve con (o sin) el Bearer. */
  async function sessionFlow(
    token: string,
    options: {
      provider?: OAuthProvider;
      purpose: 'reauthenticate' | 'connect';
      identity?: Partial<FakeIdentity>;
      returnPath?: string;
      callbackToken?: string | null;
    },
  ) {
    const provider = options.provider ?? 'google';
    const started = await authed(token)
      .post(`/users/me/oauth/${provider}/authorization`)
      .send({
        purpose: options.purpose,
        ...(options.returnPath ? { returnPath: options.returnPath } : {}),
      });
    if (started.status !== 201) return { started, response: undefined };
    const identity = newIdentity(options.identity);
    const callbackUrl = await completeFakeAuthorization(
      started.body.authorizationUrl as string,
      identity,
    );
    const request = api(t.app).post(`/auth/oauth/${provider}/callback`);
    const callbackToken = options.callbackToken === undefined ? token : options.callbackToken;
    if (callbackToken) request.set('Authorization', `Bearer ${callbackToken}`);
    const response = await request.send({
      flowToken: started.body.flowToken,
      callbackQuery: callbackUrl.search.slice(1),
    });
    return { started, response, identity };
  }

  const authenticatedAt = async (token: string) => {
    const [row] = await t.db
      .select({ at: sessions.authenticatedAt })
      .from(sessions)
      .where(eq(sessions.tokenHash, hashOpaqueToken(token)));
    return row?.at.toISOString();
  };

  describe('reautenticación con proveedor (§9.1)', () => {
    it('con la identidad de la cuenta → reauthenticated y authenticated_at renovado', async () => {
      const account = await providerAccount();
      t.clock.advanceMinutes(15);
      const { started, response } = await sessionFlow(account.token, {
        purpose: 'reauthenticate',
        identity: { subject: account.identity.subject, email: account.identity.email },
        returnPath: '/account/delete',
      });
      const url = new URL(started.body.authorizationUrl as string);
      expect(url.searchParams.get('prompt')).toBe('select_account');
      expect(url.searchParams.get('login_hint')).toBe(account.identity.email);
      expect(response?.body).toEqual({ result: 'reauthenticated', returnPath: '/account/delete' });
      expect(await authenticatedAt(account.token)).toBe(t.clock.now().toISOString());
    });

    it('O-17 (parte): con otro subject → identity_mismatch y no se renueva nada', async () => {
      const account = await providerAccount();
      t.clock.advanceMinutes(15);
      const { response } = await sessionFlow(account.token, { purpose: 'reauthenticate' });
      expect(response?.body).toEqual({
        result: 'failed',
        reason: 'identity_mismatch',
        entryPoint: 'account',
        returnPath: null,
      });
      expect(await authenticatedAt(account.token)).toBe(TEST_NOW);
    });

    it('sin ese proveedor unido → 404 al empezar', async () => {
      const account = await providerAccount('google');
      const response = await authed(account.token)
        .post('/users/me/oauth/facebook/authorization')
        .send({ purpose: 'reauthenticate' });
      expect(response.status).toBe(404);
    });

    it('O-18: la vuelta sin Bearer, o con el de otra sesión → OAUTH_FLOW_INVALID', async () => {
      const account = await providerAccount();
      const other = await providerAccount();
      for (const callbackToken of [null, other.token]) {
        const { response } = await sessionFlow(account.token, {
          purpose: 'reauthenticate',
          identity: { subject: account.identity.subject },
          callbackToken,
        });
        expect(response?.status).toBe(400);
        expect(response?.body.error.code).toBe('OAUTH_FLOW_INVALID');
      }
    });

    it('O-18: cerrar la sesión borra en cascada su flujo en curso', async () => {
      const account = await providerAccount();
      const started = await authed(account.token)
        .post('/users/me/oauth/google/authorization')
        .send({ purpose: 'reauthenticate' });
      expect(started.status).toBe(201);
      expect(await countRows(t.db, 'oauth_states')).toBe(1);
      expect((await authed(account.token).post('/auth/logout')).status).toBe(204);
      expect(await countRows(t.db, 'oauth_states')).toBe(0);
    });
  });

  describe('O-23: añadir un proveedor (§9.3)', () => {
    it('sesión no reciente → 403 REAUTHENTICATION_REQUIRED al empezar', async () => {
      const account = await providerAccount();
      t.clock.advanceMinutes(11);
      const response = await authed(account.token)
        .post('/users/me/oauth/facebook/authorization')
        .send({ purpose: 'connect' });
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('REAUTHENTICATION_REQUIRED');
      expect(await countRows(t.db, 'oauth_states')).toBe(0);
    });

    it('reciente → connected, con un correo distinto y sin verificar; no cambia authenticated_at', async () => {
      const account = await providerAccount('google');
      t.clock.advanceMinutes(5);
      const { response, identity } = await sessionFlow(account.token, {
        provider: 'facebook',
        purpose: 'connect',
        identity: { email: 'otro.correo@example.com' },
      });
      expect(response?.body).toEqual({ result: 'connected' });
      const rows = await t.db
        .select()
        .from(identities)
        .where(eq(identities.userId, account.userId));
      expect(rows.map((row) => row.provider).sort()).toEqual(['facebook', 'google']);
      expect(rows.find((row) => row.provider === 'facebook')?.subject).toBe(identity?.subject);
      expect(await authenticatedAt(account.token)).toBe(TEST_NOW);
    });

    it('la identidad ya es de otra cuenta → identity_in_use', async () => {
      const owner = await providerAccount('facebook');
      const account = await providerAccount('google');
      const { response } = await sessionFlow(account.token, {
        provider: 'facebook',
        purpose: 'connect',
        identity: { subject: owner.identity.subject },
      });
      expect(response?.body).toMatchObject({ result: 'failed', reason: 'identity_in_use' });
    });

    it('un segundo Google con otro subject → already_linked; el mismo → connected sin cambios', async () => {
      const account = await providerAccount('google');
      const second = await sessionFlow(account.token, { provider: 'google', purpose: 'connect' });
      expect(second.response?.body).toMatchObject({ result: 'failed', reason: 'already_linked' });
      const same = await sessionFlow(account.token, {
        provider: 'google',
        purpose: 'connect',
        identity: { subject: account.identity.subject },
      });
      expect(same.response?.body).toEqual({ result: 'connected' });
      expect(await countRows(t.db, 'identities')).toBe(1);
    });

    it('cancelar en el proveedor → failed cancelled con entryPoint account', async () => {
      const account = await providerAccount('google');
      const started = await authed(account.token)
        .post('/users/me/oauth/facebook/authorization')
        .send({ purpose: 'connect', returnPath: '/account' });
      const url = await completeFakeAuthorization(started.body.authorizationUrl as string, {
        subject: 'x',
        decision: 'deny',
      });
      const response = await authed(account.token)
        .post('/auth/oauth/facebook/callback')
        .send({ flowToken: started.body.flowToken, callbackQuery: url.search.slice(1) });
      expect(response.body).toEqual({
        result: 'failed',
        reason: 'cancelled',
        entryPoint: 'account',
        returnPath: '/account',
      });
    });
  });

  describe('reautenticación con contraseña (§9.1, T16)', () => {
    it('O-23: correcta → 204 y authenticated_at renovado; errónea → 403 y no se renueva', async () => {
      const user = await registerUser(t.app);
      t.clock.advanceMinutes(20);
      const wrong = await authed(user.token)
        .post('/users/me/reauthentication')
        .send({ password: 'otra-cosa-mala' });
      expect(wrong.status).toBe(403);
      expect(wrong.body.error.code).toBe('PASSWORD_INCORRECT');
      expect(await authenticatedAt(user.token)).toBe(TEST_NOW);

      const right = await authed(user.token)
        .post('/users/me/reauthentication')
        .send({ password: user.password });
      expect(right.status).toBe(204);
      expect(await authenticatedAt(user.token)).toBe(t.clock.now().toISOString());
    });

    it('una cuenta sin contraseña → 404', async () => {
      const account = await providerAccount();
      const response = await authed(account.token)
        .post('/users/me/reauthentication')
        .send({ password: 'lo-que-sea-largo' });
      expect(response.status).toBe(404);
    });

    it('O-22: cubo de sesión: 3 reautenticaciones y 2 borrados fallidos → el siguiente da 429', async () => {
      const user = await registerUser(t.app);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect(
          (
            await authed(user.token)
              .post('/users/me/reauthentication')
              .send({ password: 'mala-mala-1' })
          ).status,
        ).toBe(403);
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        expect(
          (await authed(user.token).post('/users/me/deletion').send({ password: 'mala-mala-1' }))
            .status,
        ).toBe(403);
      }
      const blocked = await authed(user.token)
        .post('/users/me/reauthentication')
        .send({ password: user.password });
      expect(blocked.status).toBe(429);
      expect(blocked.headers['retry-after']).toBeDefined();
      expect(await countRows(t.db, 'users')).toBe(1);
    });

    it('O-22: el inicio con sesión tiene su propio límite: el 6.º en 15 minutos → 429', async () => {
      const account = await providerAccount();
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        statuses.push(
          (
            await authed(account.token)
              .post('/users/me/oauth/google/authorization')
              .send({ purpose: 'reauthenticate' })
          ).status,
        );
      }
      expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
      // No comparte cubo con las contraseñas.
      expect(
        (
          await authed(account.token)
            .post('/users/me/reauthentication')
            .send({ password: 'x-x-x-x-x' })
        ).status,
      ).toBe(404);
    });
  });

  describe('O-19: quitar un proveedor (§9.4)', () => {
    it('con contraseña → 204; no cierra la sesión', async () => {
      const user = await registerUser(t.app);
      const linked = await runFlow(t.app, { identity: { email: user.email } });
      const joined = await api(t.app).post('/auth/oauth/link').send({
        pendingToken: linked.response.body.pending.token,
        email: user.email,
        password: user.password,
      });
      expect(joined.status).toBe(200);
      const response = await authed(user.token).post('/users/me/identities/google/removal');
      expect(response.status).toBe(204);
      expect(await countRows(t.db, 'identities')).toBe(0);
      expect((await authed(user.token).get('/users/me')).status).toBe(200);
    });

    it('única identidad y sin contraseña → 409 LAST_SIGN_IN_METHOD; sin ese proveedor → 404', async () => {
      const account = await providerAccount('google');
      const last = await authed(account.token).post('/users/me/identities/google/removal');
      expect(last.status).toBe(409);
      expect(last.body.error.code).toBe('LAST_SIGN_IN_METHOD');
      expect(
        (await authed(account.token).post('/users/me/identities/facebook/removal')).status,
      ).toBe(404);
      expect(
        (await authed(account.token).post('/users/me/identities/twitter/removal')).status,
      ).toBe(404);
      expect(await countRows(t.db, 'identities')).toBe(1);
    });

    it('dos identidades y sin contraseña: dos retiradas simultáneas → una 204 y otra 409', async () => {
      const account = await providerAccount('google');
      const connected = await sessionFlow(account.token, {
        provider: 'facebook',
        purpose: 'connect',
      });
      expect(connected.response?.body).toEqual({ result: 'connected' });
      const responses = await Promise.all([
        authed(account.token).post('/users/me/identities/google/removal'),
        authed(account.token).post('/users/me/identities/facebook/removal'),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([204, 409]);
      expect(await countRows(t.db, 'identities')).toBe(1);
      const [user] = await t.db.select().from(users);
      expect(user?.passwordHash).toBeNull();
    });
  });
});
