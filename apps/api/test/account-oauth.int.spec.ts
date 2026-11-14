import type { OAuthProvider } from '@cupidilla/contracts';
import { completeFakeAuthorization, type FakeIdentity } from '@cupidilla/fake-oauth-provider';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashOpaqueToken } from '../src/common/crypto/opaque-token.js';
import { identities, oauthStates, sessions, users } from '../src/database/schema/index.js';
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

  /**
   * Flujo con sesión: empieza, pasa por el proveedor falso y vuelve con (o sin) el Bearer. Con
   * `confirm`, la cuenta no tiene contraseña y añade un proveedor: antes pasa por el proveedor
   * unido con esa identidad, y sigue con el flujo de `connect_confirmed` (decisión 21).
   */
  async function sessionFlow(
    token: string,
    options: {
      provider?: OAuthProvider;
      purpose: 'reauthenticate' | 'connect';
      identity?: Partial<FakeIdentity>;
      confirm?: Partial<FakeIdentity>;
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
    let flowToken = started.body.flowToken as string;
    let authorizationUrl = started.body.authorizationUrl as string;
    if (options.confirm) {
      const confirmUrl = await completeFakeAuthorization(
        authorizationUrl,
        newIdentity(options.confirm),
      );
      const confirmed = await authed(token)
        .post(`/auth/oauth/${other(provider)}/callback`)
        .send({ flowToken, callbackQuery: confirmUrl.search.slice(1) });
      if (confirmed.body.result !== 'connect_confirmed') {
        return { started, confirmed, response: confirmed };
      }
      flowToken = confirmed.body.next.flowToken as string;
      authorizationUrl = confirmed.body.next.authorizationUrl as string;
    }
    const identity = newIdentity(options.identity);
    const callbackUrl = await completeFakeAuthorization(authorizationUrl, identity);
    const request = api(t.app).post(`/auth/oauth/${provider}/callback`);
    const callbackToken = options.callbackToken === undefined ? token : options.callbackToken;
    if (callbackToken) request.set('Authorization', `Bearer ${callbackToken}`);
    const response = await request.send({
      flowToken,
      callbackQuery: callbackUrl.search.slice(1),
    });
    return { started, response, identity, flowToken, callbackQuery: callbackUrl.search.slice(1) };
  }

  const other = (provider: OAuthProvider): OAuthProvider =>
    provider === 'google' ? 'facebook' : 'google';

  const stateRows = () => t.db.select().from(oauthStates);

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

  describe('O-23: añadir un proveedor sin contraseña, con confirmación (decisión 21)', () => {
    /** Inicio de «Añadir Google» en una cuenta sin contraseña creada con Facebook. */
    const startConnect = (token: string, provider: OAuthProvider = 'google') =>
      authed(token)
        .post(`/users/me/oauth/${provider}/authorization`)
        .send({ purpose: 'connect', returnPath: '/account' });

    /** Confirma con el Facebook unido; devuelve la respuesta de la vuelta. */
    async function confirm(
      token: string,
      started: { body: { flowToken: string; authorizationUrl: string } },
      identity: Partial<FakeIdentity> & { decision?: 'approve' | 'deny' },
    ) {
      const url = await completeFakeAuthorization(started.body.authorizationUrl, {
        ...newIdentity(identity),
        decision: identity.decision,
      });
      return authed(token)
        .post('/auth/oauth/facebook/callback')
        .send({ flowToken: started.body.flowToken, callbackQuery: url.search.slice(1) });
    }

    /** Pasa por Google con `identity` y vuelve con `next.flowToken`. */
    async function finish(
      token: string | null,
      next: { flowToken: string; authorizationUrl: string },
      identity: Partial<FakeIdentity> = {},
    ) {
      const url = await completeFakeAuthorization(next.authorizationUrl, newIdentity(identity));
      const request = api(t.app).post('/auth/oauth/google/callback');
      if (token) request.set('Authorization', `Bearer ${token}`);
      const body = { flowToken: next.flowToken, callbackQuery: url.search.slice(1) };
      return { response: await request.send(body), body };
    }

    for (const [name, minutes] of [
      ['C1: sesión de hace 1 minuto', 1],
      ['C2: sesión de hace 1 hora (ya no hay 403)', 60],
    ] as const) {
      it(`${name} → 201 con la URL del Facebook unido y ninguna fila connect`, async () => {
        const account = await providerAccount('facebook');
        t.clock.advanceMinutes(minutes);
        const started = await startConnect(account.token);
        expect(started.status).toBe(201);
        const url = new URL(started.body.authorizationUrl as string);
        expect(url.pathname).toMatch(/^\/facebook\//);
        const rows = await stateRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          provider: 'facebook',
          purpose: 'reauthenticate',
          connectProvider: 'google',
          newPasswordHash: null,
          sessionTokenHash: hashOpaqueToken(account.token),
          returnPath: '/account',
        });
      });
    }

    it('C3: la confirmación crea la fila connect de 5 minutos; Google la completa → connected', async () => {
      const account = await providerAccount('facebook');
      t.clock.advanceMinutes(30);
      const started = await startConnect(account.token);
      const confirmed = await confirm(account.token, started, {
        subject: account.identity.subject,
      });
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.result).toBe('connect_confirmed');
      const next = confirmed.body.next as { flowToken: string; authorizationUrl: string };
      expect(new URL(next.authorizationUrl).pathname).toMatch(/^\/google\//);
      expect(confirmed.body.next.expiresAt).toBe(
        new Date(t.clock.now().getTime() + 5 * 60_000).toISOString(),
      );
      expect(await authenticatedAt(account.token)).toBe(t.clock.now().toISOString());
      const rows = await stateRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        provider: 'google',
        purpose: 'connect',
        connectProvider: null,
        sessionTokenHash: hashOpaqueToken(account.token),
        returnPath: '/account',
        expiresAt: new Date(t.clock.now().getTime() + 5 * 60_000),
      });

      const { response } = await finish(account.token, next);
      expect(response.body).toEqual({ result: 'connected' });
      const linked = await t.db
        .select()
        .from(identities)
        .where(eq(identities.userId, account.userId));
      expect(linked.map((row) => row.provider).sort()).toEqual(['facebook', 'google']);
    });

    it('C4: reutilizar el flowToken de next tras completar → OAUTH_FLOW_INVALID sin cambios', async () => {
      const account = await providerAccount('facebook');
      const started = await startConnect(account.token);
      const confirmed = await confirm(account.token, started, {
        subject: account.identity.subject,
      });
      const { response, body } = await finish(account.token, confirmed.body.next);
      expect(response.body).toEqual({ result: 'connected' });
      const again = await authed(account.token).post('/auth/oauth/google/callback').send(body);
      expect(again.status).toBe(400);
      expect(again.body.error.code).toBe('OAUTH_FLOW_INVALID');
      expect(await countRows(t.db, 'identities')).toBe(2);
    });

    it('C5: la vuelta de Google con el Bearer de otra sesión, o tras cerrar la sesión → OAUTH_FLOW_INVALID', async () => {
      const account = await providerAccount('facebook');
      // Otra sesión de la misma cuenta: entrar otra vez con el mismo Facebook.
      const signIn = await runFlow(t.app, {
        provider: 'facebook',
        identity: { subject: account.identity.subject, email: account.identity.email },
      });
      expect(signIn.response.body.result).toBe('signed_in');
      const otherToken = signIn.response.body.session.token as string;

      const started = await startConnect(account.token);
      const confirmed = await confirm(account.token, started, {
        subject: account.identity.subject,
      });
      const { response } = await finish(otherToken, confirmed.body.next);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('OAUTH_FLOW_INVALID');

      const startedAgain = await startConnect(account.token);
      const confirmedAgain = await confirm(account.token, startedAgain, {
        subject: account.identity.subject,
      });
      expect(confirmedAgain.body.result).toBe('connect_confirmed');
      expect((await authed(account.token).post('/auth/logout')).status).toBe(204);
      expect(await countRows(t.db, 'oauth_states')).toBe(0);
      const afterLogout = await finish(account.token, confirmedAgain.body.next);
      expect(afterLogout.response.status).toBe(400);
      expect(afterLogout.response.body.error.code).toBe('OAUTH_FLOW_INVALID');
      expect(await countRows(t.db, 'identities')).toBe(1);
    });

    it('C6: la confirmación caduca a los 5 minutos justos', async () => {
      const account = await providerAccount('facebook');
      const started = await startConnect(account.token);
      const confirmed = await confirm(account.token, started, {
        subject: account.identity.subject,
      });
      t.clock.advanceMinutes(5);
      const late = await finish(account.token, confirmed.body.next);
      expect(late.response.status).toBe(400);
      expect(late.response.body.error.code).toBe('OAUTH_FLOW_INVALID');
      expect(await countRows(t.db, 'identities')).toBe(1);

      const startedAgain = await startConnect(account.token);
      const confirmedAgain = await confirm(account.token, startedAgain, {
        subject: account.identity.subject,
      });
      t.clock.advanceMinutes(4 + 59 / 60);
      const inTime = await finish(account.token, confirmedAgain.body.next);
      expect(inTime.response.body).toEqual({ result: 'connected' });
    });

    it('C7: la confirmación vuelve con otro subject → identity_mismatch, sin fila connect', async () => {
      const account = await providerAccount('facebook');
      t.clock.advanceMinutes(30);
      const started = await startConnect(account.token);
      const confirmed = await confirm(account.token, started, {});
      expect(confirmed.body).toEqual({
        result: 'failed',
        reason: 'identity_mismatch',
        entryPoint: 'account',
        returnPath: '/account',
      });
      expect(await countRows(t.db, 'oauth_states')).toBe(0);
      expect(await authenticatedAt(account.token)).toBe(TEST_NOW);
    });

    it('C8: cancelar en Facebook → cancelled y ninguna fila connect', async () => {
      const account = await providerAccount('facebook');
      const started = await startConnect(account.token);
      const confirmed = await confirm(account.token, started, {
        subject: account.identity.subject,
        decision: 'deny',
      });
      expect(confirmed.body).toEqual({
        result: 'failed',
        reason: 'cancelled',
        entryPoint: 'account',
        returnPath: '/account',
      });
      expect(await countRows(t.db, 'oauth_states')).toBe(0);
    });

    it('C9: cuenta con solo Google que pide añadir Google → 404 y ninguna fila', async () => {
      const account = await providerAccount('google');
      const response = await startConnect(account.token, 'google');
      expect(response.status).toBe(404);
      expect(await countRows(t.db, 'oauth_states')).toBe(0);
    });

    it('con los dos unidos, confirma el usado más recientemente', async () => {
      const account = await providerAccount('google');
      const connected = await sessionFlow(account.token, {
        provider: 'facebook',
        purpose: 'connect',
        confirm: { subject: account.identity.subject },
      });
      expect(connected.response?.body).toEqual({ result: 'connected' });
      await t.db.delete(oauthStates);
      // Facebook es el último usado (se unió después): «Añadir Google» confirma con Facebook.
      const started = await startConnect(account.token, 'google');
      expect(started.status).toBe(201);
      expect(new URL(started.body.authorizationUrl as string).pathname).toMatch(/^\/facebook\//);
    });

    it('la identidad ya es de otra cuenta → identity_in_use', async () => {
      const owner = await providerAccount('facebook');
      const account = await providerAccount('google');
      const { response } = await sessionFlow(account.token, {
        provider: 'facebook',
        purpose: 'connect',
        confirm: { subject: account.identity.subject },
        identity: { subject: owner.identity.subject },
      });
      expect(response?.body).toMatchObject({ result: 'failed', reason: 'identity_in_use' });
    });

    it('cancelar en el proveedor nuevo → failed cancelled con entryPoint account', async () => {
      const account = await providerAccount('facebook');
      const started = await startConnect(account.token);
      const confirmed = await confirm(account.token, started, {
        subject: account.identity.subject,
      });
      const url = await completeFakeAuthorization(confirmed.body.next.authorizationUrl as string, {
        subject: 'x',
        decision: 'deny',
      });
      const response = await authed(account.token)
        .post('/auth/oauth/google/callback')
        .send({ flowToken: confirmed.body.next.flowToken, callbackQuery: url.search.slice(1) });
      expect(response.body).toEqual({
        result: 'failed',
        reason: 'cancelled',
        entryPoint: 'account',
        returnPath: '/account',
      });
      expect(await countRows(t.db, 'oauth_states')).toBe(0);
    });
  });

  describe('O-23: correo del proveedor al añadir (decisión 21, cambios 1 y 2)', () => {
    it('1: Google con el correo sin verificar → email_unverified y A no gana nada', async () => {
      const account = await providerAccount('facebook');
      const { response } = await sessionFlow(account.token, {
        provider: 'google',
        purpose: 'connect',
        confirm: { subject: account.identity.subject },
        identity: { email: 'otro.correo@example.com', emailVerified: false },
      });
      expect(response?.body).toEqual({
        result: 'failed',
        reason: 'email_unverified',
        entryPoint: 'account',
        returnPath: null,
      });
      expect(await countRows(t.db, 'identities')).toBe(1);
    });

    it('1 (con contraseña): Google sin verificar → email_unverified', async () => {
      const user = await registerUser(t.app);
      const started = await authed(user.token)
        .post('/users/me/oauth/google/authorization')
        .send({ purpose: 'connect', password: user.password });
      const url = await completeFakeAuthorization(started.body.authorizationUrl as string, {
        subject: 'g-unverified',
        email: user.email,
        emailVerified: false,
      });
      const response = await authed(user.token)
        .post('/auth/oauth/google/callback')
        .send({ flowToken: started.body.flowToken, callbackQuery: url.search.slice(1) });
      expect(response.body).toMatchObject({ result: 'failed', reason: 'email_unverified' });
      expect(await countRows(t.db, 'identities')).toBe(0);
    });

    it('2: Facebook sin correo → email_missing', async () => {
      const account = await providerAccount('google');
      const { response } = await sessionFlow(account.token, {
        provider: 'facebook',
        purpose: 'connect',
        confirm: { subject: account.identity.subject },
        identity: { email: '' },
      });
      expect(response?.body).toMatchObject({ result: 'failed', reason: 'email_missing' });
      expect(await countRows(t.db, 'identities')).toBe(1);
    });

    it('5: el correo es el de la cuenta B → connect_refused y A no gana nada', async () => {
      await registerUser(t.app, { email: 'y@gmail.com' });
      const account = await providerAccount('facebook');
      for (const email of ['y@gmail.com', 'Y@Gmail.com']) {
        const { response } = await sessionFlow(account.token, {
          provider: 'google',
          purpose: 'connect',
          confirm: { subject: account.identity.subject },
          identity: { email },
        });
        expect(response?.body).toEqual({
          result: 'failed',
          reason: 'connect_refused',
          entryPoint: 'account',
          returnPath: null,
        });
      }
      const linked = await t.db
        .select()
        .from(identities)
        .where(eq(identities.userId, account.userId));
      expect(linked.map((row) => row.provider)).toEqual(['facebook']);
    });

    it('5 (con contraseña): el correo de otra cuenta → connect_refused', async () => {
      await registerUser(t.app, { email: 'y@gmail.com' });
      const user = await registerUser(t.app);
      const started = await authed(user.token)
        .post('/users/me/oauth/google/authorization')
        .send({ purpose: 'connect', password: user.password });
      const url = await completeFakeAuthorization(started.body.authorizationUrl as string, {
        subject: 'g-y',
        email: 'y@gmail.com',
      });
      const response = await authed(user.token)
        .post('/auth/oauth/google/callback')
        .send({ flowToken: started.body.flowToken, callbackQuery: url.search.slice(1) });
      expect(response.body).toMatchObject({ result: 'failed', reason: 'connect_refused' });
      expect(await countRows(t.db, 'identities')).toBe(0);
    });

    it('5b (decisión 21, pregunta 2): el provider_email verificado de una identidad de otra cuenta → connect_refused', async () => {
      const owner = await providerAccount('google');
      await t.db.insert(identities).values({
        userId: owner.userId,
        provider: 'facebook',
        subject: 'fb-owner',
        providerEmail: ' Z@Gmail.com ',
        emailVerified: true,
        createdAt: t.clock.now(),
        lastUsedAt: t.clock.now(),
      });
      const account = await providerAccount('facebook');
      const { response } = await sessionFlow(account.token, {
        provider: 'google',
        purpose: 'connect',
        confirm: { subject: account.identity.subject },
        identity: { email: 'z@gmail.com' },
      });
      expect(response?.body).toMatchObject({ result: 'failed', reason: 'connect_refused' });
      expect(await countRows(t.db, 'identities')).toBe(3);
    });

    it('5c: una identidad de otra cuenta con ese correo sin verificar (dato antiguo) no bloquea', async () => {
      const owner = await providerAccount('google');
      await t.db.insert(identities).values({
        userId: owner.userId,
        provider: 'facebook',
        subject: 'fb-owner',
        providerEmail: 'z@gmail.com',
        emailVerified: false,
        createdAt: t.clock.now(),
        lastUsedAt: t.clock.now(),
      });
      const account = await providerAccount('facebook');
      const { response } = await sessionFlow(account.token, {
        provider: 'google',
        purpose: 'connect',
        confirm: { subject: account.identity.subject },
        identity: { email: 'z@gmail.com' },
      });
      expect(response?.body).toEqual({ result: 'connected' });
    });

    it('6: con el correo de la propia cuenta, o uno libre → connected', async () => {
      const own = await providerAccount('facebook');
      const withOwn = await sessionFlow(own.token, {
        provider: 'google',
        purpose: 'connect',
        confirm: { subject: own.identity.subject },
        identity: { email: own.identity.email },
      });
      expect(withOwn.response?.body).toEqual({ result: 'connected' });

      const free = await providerAccount('facebook');
      const withFree = await sessionFlow(free.token, {
        provider: 'google',
        purpose: 'connect',
        confirm: { subject: free.identity.subject },
        identity: { email: 'libre@example.com' },
      });
      expect(withFree.response?.body).toEqual({ result: 'connected' });
      const [row] = await t.db
        .select()
        .from(identities)
        .where(eq(identities.subject, withFree.identity!.subject));
      expect(row).toMatchObject({
        userId: free.userId,
        providerEmail: 'libre@example.com',
        emailVerified: true,
      });
    });
  });

  describe('añadir un proveedor a una cuenta con contraseña (decisión 20)', () => {
    async function passwordAccount() {
      const user = await registerUser(t.app);
      return user;
    }
    const start = (token: string, body: object) =>
      authed(token)
        .post('/users/me/oauth/facebook/authorization')
        .send({ purpose: 'connect', ...body });

    it('sin contraseña → 400; errónea → 403; sin escribir nada en oauth_states', async () => {
      const user = await passwordAccount();
      const missing = await start(user.token, {});
      expect(missing.status).toBe(400);
      expect(missing.body.error.fields).toEqual([{ path: 'password', issue: 'required' }]);
      const wrong = await start(user.token, { password: 'otra-contraseña-mala' });
      expect(wrong.status).toBe(403);
      expect(wrong.body.error.code).toBe('PASSWORD_INCORRECT');
      expect(await countRows(t.db, 'oauth_states')).toBe(0);
    });

    it('C10: con la contraseña correcta vale aunque la sesión tenga horas, sin pasar por otro proveedor', async () => {
      const user = await passwordAccount();
      t.clock.advanceMinutes(180);
      const started = await start(user.token, { password: user.password });
      expect(started.status).toBe(201);
      expect(new URL(started.body.authorizationUrl as string).pathname).toMatch(/^\/facebook\//);
      const rows = await stateRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        provider: 'facebook',
        purpose: 'connect',
        connectProvider: null,
      });
      const callbackUrl = await completeFakeAuthorization(started.body.authorizationUrl as string, {
        subject: `fb-${user.userId}`,
        email: user.email,
      });
      const response = await authed(user.token)
        .post('/auth/oauth/facebook/callback')
        .send({ flowToken: started.body.flowToken, callbackQuery: callbackUrl.search.slice(1) });
      expect(response.body).toEqual({ result: 'connected' });
      expect(await countRows(t.db, 'identities')).toBe(1);
    });

    it('un segundo Facebook con otro subject → already_linked; el mismo → connected sin cambios', async () => {
      const user = await passwordAccount();
      const connectFacebook = async (subject: string) => {
        const started = await start(user.token, { password: user.password });
        const url = await completeFakeAuthorization(started.body.authorizationUrl as string, {
          subject,
          email: user.email,
        });
        return authed(user.token)
          .post('/auth/oauth/facebook/callback')
          .send({ flowToken: started.body.flowToken, callbackQuery: url.search.slice(1) });
      };
      expect((await connectFacebook('fb-1')).body).toEqual({ result: 'connected' });
      expect((await connectFacebook('fb-2')).body).toMatchObject({
        result: 'failed',
        reason: 'already_linked',
      });
      expect((await connectFacebook('fb-1')).body).toEqual({ result: 'connected' });
      expect(await countRows(t.db, 'identities')).toBe(1);
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

    it('O-22: empezar con sesión cuenta en el cubo de contraseñas de la sesión (decisión 20)', async () => {
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
      // Al añadir un proveedor se puede escribir la contraseña: comparte cubo con las demás rutas
      // que la comprueban, así que tras 5 intentos queda bloqueada también la reautenticación.
      expect(
        (
          await authed(account.token)
            .post('/users/me/reauthentication')
            .send({ password: 'x-x-x-x-x' })
        ).status,
      ).toBe(429);
    });
  });

  describe('O-19: quitar un proveedor (§9.4)', () => {
    it('con contraseña: hay que escribirla (sin ella 400, errónea 403, correcta 204); no cierra la sesión', async () => {
      const user = await registerUser(t.app);
      const linked = await runFlow(t.app, { identity: { email: user.email } });
      const joined = await api(t.app).post('/auth/oauth/link').send({
        pendingToken: linked.response.body.pending.token,
        email: user.email,
        password: user.password,
      });
      expect(joined.status).toBe(200);
      const remove = (body: object) =>
        authed(user.token).post('/users/me/identities/google/removal').send(body);
      // Decisión 20: con contraseña en la cuenta, hay que escribirla.
      const missing = await remove({});
      expect(missing.status).toBe(400);
      expect(missing.body.error.fields).toEqual([{ path: 'password', issue: 'required' }]);
      const wrong = await remove({ password: 'otra-contraseña-mala' });
      expect(wrong.status).toBe(403);
      expect(wrong.body.error.code).toBe('PASSWORD_INCORRECT');
      expect(await countRows(t.db, 'identities')).toBe(1);
      const response = await remove({ password: user.password });
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
        confirm: { subject: account.identity.subject },
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
