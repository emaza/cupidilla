import {
  OAUTH_PENDING_TTL_MINUTES,
  oauthAuthResponseSchema,
  oauthCallbackResponseSchema,
  oauthStartResponseSchema,
  pendingIdentityResponseSchema,
  SERVICE_TERMS_VERSION,
} from '@cupidilla/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashOpaqueToken } from '../src/common/crypto/opaque-token.js';
import {
  consents,
  identities,
  oauthStates,
  pendingIdentities,
  sessions,
  users,
} from '../src/database/schema/index.js';
import { PROVIDER_CLIENTS } from '../src/oauth/providers/provider-clients.js';
import {
  FAKE_PROVIDER_URL,
  OAUTH_HTTP_TIMEOUT_MS,
  OAUTH_REDIRECT_BASE_URL,
  OAUTH_TEST_ENV,
} from './helpers/oauth-env.js';
import {
  authorize,
  callback,
  newIdentity,
  runFlow,
  signupBody,
  startFlow,
} from './helpers/oauth.js';
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

describe('Entrada con Google: inicio, vuelta y alta pendiente (fase 2)', () => {
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

  const pending = (token: string) =>
    api(t.app).get('/auth/oauth/pending').set('X-Oauth-Pending-Token', token);
  const signup = (body: Record<string, unknown>) =>
    api(t.app).post('/auth/oauth/signup').send(body);

  /** Flujo hasta `signup_required`; devuelve el token pendiente y la identidad. */
  async function untilSignup(options: Parameters<typeof runFlow>[1] = {}) {
    const flow = await runFlow(t.app, options);
    expect(flow.response.status).toBe(200);
    expect(flow.response.body.result).toBe('signup_required');
    return { identity: flow.identity, token: flow.response.body.pending.token as string };
  }

  it('GET /auth/oauth/providers: los configurados, en el orden de la interfaz', async () => {
    const response = await api(t.app).get('/auth/oauth/providers');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ providers: ['google', 'facebook'] });
  });

  it('O-1: la URL lleva lo exigido y la fila dura 10 minutos; la caducada de otro flujo se limpia', async () => {
    await startFlow(t.app); // flujo A
    t.clock.advanceMinutes(11); // A ha caducado
    const response = await startFlow(t.app, {
      entryPoint: 'register',
      returnPath: '/account/delete',
    });
    expect(response.status).toBe(201);
    const body = oauthStartResponseSchema.parse(response.body);

    const url = new URL(body.authorizationUrl);
    expect(url.origin + url.pathname).toBe(`${FAKE_PROVIDER_URL}/google/authorize`);
    expect(url.searchParams.get('redirect_uri')).toBe(
      `${OAUTH_REDIRECT_BASE_URL}/auth/google/callback`,
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    for (const name of ['state', 'nonce', 'code_challenge']) {
      expect(url.searchParams.get(name)).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    }

    const rows = await t.db.select().from(oauthStates);
    expect(rows).toHaveLength(1); // la de A se ha borrado al insertar la nueva
    const [row] = rows;
    expect(row?.tokenHash).toBe(hashOpaqueToken(body.flowToken));
    expect(row).toMatchObject({
      purpose: 'sign_in',
      entryPoint: 'register',
      returnPath: '/account/delete',
    });
    expect(row!.expiresAt.getTime() - row!.createdAt.getTime()).toBe(10 * 60_000);
    expect(body.expiresAt).toBe(row!.expiresAt.toISOString());
  });

  it('inicio: proveedor desconocido → 404; cuerpo inválido → 400', async () => {
    expect(
      (await api(t.app).post('/auth/oauth/twitter/authorization').send({ entryPoint: 'login' }))
        .status,
    ).toBe(404);
    const invalid = await api(t.app)
      .post('/auth/oauth/google/authorization')
      .send({ entryPoint: 'login', returnPath: '//evil.example' });
    expect(invalid.status).toBe(400);
    expect(await countRows(t.db, 'oauth_states')).toBe(0);
  });

  it('O-2: Google nuevo con correo verificado → signup_required; la fila del flujo se consume y hay un pendiente de 30 min', async () => {
    const flow = await runFlow(t.app, { entryPoint: 'register' });
    expect(flow.response.status).toBe(200);
    const body = oauthCallbackResponseSchema.parse(flow.response.body);
    expect(body.result).toBe('signup_required');
    expect(await countRows(t.db, 'oauth_states')).toBe(0);

    const [row] = await t.db.select().from(pendingIdentities);
    expect(row).toMatchObject({
      kind: 'signup',
      provider: 'google',
      subject: flow.identity.subject,
      providerEmail: flow.identity.email,
      emailVerified: true,
      entryPoint: 'register',
      userId: null,
    });
    expect(row!.expiresAt.getTime() - row!.createdAt.getTime()).toBe(
      OAUTH_PENDING_TTL_MINUTES * 60_000,
    );

    const lookup = await pending((body as { pending: { token: string } }).pending.token);
    expect(lookup.status).toBe(200);
    expect(pendingIdentityResponseSchema.parse(lookup.body)).toEqual({
      kind: 'signup',
      provider: 'google',
      email: flow.identity.email,
      entryPoint: 'register',
      expiresAt: row!.expiresAt.toISOString(),
    });
  });

  it('O-3: alta de una persona adulta → 201 con cuenta sin contraseña, identidad, consentimiento y sesión', async () => {
    const { identity, token } = await untilSignup({ returnPath: '/account/delete' });
    t.clock.advanceMinutes(5);
    const response = await signup(signupBody(token));
    expect(response.status).toBe(201);
    const body = oauthAuthResponseSchema.parse(response.body);
    expect(body.user.email).toBe(identity.email);
    expect(body.returnPath).toBe('/account/delete');

    const [user] = await t.db.select().from(users);
    expect(user?.passwordHash).toBeNull();
    expect(user?.birthDate).toBe('1990-05-05');
    const [identityRow] = await t.db.select().from(identities);
    expect(identityRow).toMatchObject({
      userId: user!.id,
      provider: 'google',
      subject: identity.subject,
    });
    const [consent] = await t.db.select().from(consents);
    expect(consent).toMatchObject({ policyVersion: SERVICE_TERMS_VERSION, purpose: 'service_use' });
    expect(consent!.grantedAt.toISOString()).toBe(t.clock.now().toISOString());
    const [session] = await t.db.select().from(sessions);
    expect(session!.tokenHash).toBe(hashOpaqueToken(body.session.token));
    expect(session!.authenticatedAt.toISOString()).toBe(session!.createdAt.toISOString());
    expect(await countRows(t.db, 'pending_identities')).toBe(0);

    // La sesión sirve, y /users/me ya muestra la identidad.
    const account = await api(t.app)
      .get('/users/me')
      .set('Authorization', `Bearer ${body.session.token}`);
    expect(account.body.signInMethods).toEqual({
      password: false,
      identities: [{ provider: 'google', linkedAt: identityRow!.createdAt.toISOString() }],
    });
  });

  it('O-4: menor → 422 sin crear nada y borrando en el acto el estado pendiente', async () => {
    const { token } = await untilSignup();
    const response = await signup(signupBody(token, { birthDate: '2015-01-01' }));
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('UNDERAGE');
    for (const table of ['users', 'identities', 'consents', 'sessions', 'pending_identities']) {
      expect(await countRows(t.db, table), table).toBe(0);
    }
  });

  it('O-5: condiciones antiguas → 409 y el pendiente sigue; fecha futura → 400', async () => {
    const { token } = await untilSignup();
    const outdated = await signup(signupBody(token, { termsVersion: 'version-antigua' }));
    expect(outdated.status).toBe(409);
    expect(outdated.body.error.code).toBe('TERMS_VERSION_OUTDATED');
    const future = await signup(signupBody(token, { birthDate: '2030-01-01' }));
    expect(future.status).toBe(400);
    expect(future.body.error.fields).toEqual([{ path: 'birthDate', issue: 'in_future' }]);
    expect(await countRows(t.db, 'pending_identities')).toBe(1);
    expect((await signup(signupBody(token))).status).toBe(201);
  });

  it('O-6: identidad ya unida → signed_in aunque cambie el correo del proveedor, que se actualiza', async () => {
    const { identity, token } = await untilSignup();
    expect((await signup(signupBody(token))).status).toBe(201);

    t.clock.advanceMinutes(30);
    const again = await runFlow(t.app, {
      identity: { subject: identity.subject, email: 'Nuevo.Correo@Example.com' },
      returnPath: '/account/delete',
    });
    expect(again.response.status).toBe(200);
    const body = oauthCallbackResponseSchema.parse(again.response.body);
    expect(body).toMatchObject({ result: 'signed_in', returnPath: '/account/delete' });
    expect((body as { user: { email: string } }).user.email).toBe(identity.email);
    const [identityRow] = await t.db.select().from(identities);
    expect(identityRow?.providerEmail).toBe('nuevo.correo@example.com');
    expect(identityRow?.lastUsedAt.toISOString()).toBe(t.clock.now().toISOString());
    expect(await countRows(t.db, 'sessions')).toBe(2);
    expect(await countRows(t.db, 'pending_identities')).toBe(0);
  });

  it('O-10 (Google): correo sin verificar → email_unverified; sin correo → email_missing; sin consultar users', async () => {
    const existing = await registerUser(t.app);
    const before = await countRows(t.db, 'users');
    const findByEmail = vi.spyOn(
      t.app.get((await import('../src/users/users.service.js')).UsersService),
      'findCredentialsByEmail',
    );

    for (const email of [existing.email, 'nadie@example.com']) {
      const unverified = await runFlow(t.app, {
        entryPoint: 'register',
        identity: { email, emailVerified: false },
      });
      expect(unverified.response.body).toEqual({
        result: 'failed',
        reason: 'email_unverified',
        entryPoint: 'register',
        returnPath: null,
      });
    }
    const missing = await runFlow(t.app, { identity: { email: '' } });
    expect(missing.response.body).toMatchObject({
      result: 'failed',
      reason: 'email_missing',
      entryPoint: 'login',
    });

    expect(findByEmail).not.toHaveBeenCalled();
    expect(await countRows(t.db, 'users')).toBe(before);
    expect(await countRows(t.db, 'pending_identities')).toBe(0);
  });

  it('correo de una cuenta con contraseña → link_required, con el correo de la cuenta en pending', async () => {
    const existing = await registerUser(t.app);
    const flow = await runFlow(t.app, { identity: { email: existing.email.toUpperCase() } });
    expect(flow.response.body.result).toBe('link_required');
    const lookup = await pending(flow.response.body.pending.token as string);
    expect(lookup.body).toMatchObject({ kind: 'link', email: existing.email });
    const [row] = await t.db.select().from(pendingIdentities);
    expect(row).toMatchObject({ kind: 'link', userId: existing.userId });
  });

  it('correo de una cuenta sin contraseña creada con Google → use_other_provider con [google]', async () => {
    const { identity, token } = await untilSignup();
    expect((await signup(signupBody(token))).status).toBe(201);
    const other = await runFlow(t.app, { identity: { email: identity.email } }); // otro subject
    expect(other.response.body).toEqual({ result: 'use_other_provider', providers: ['google'] });
    expect(await countRows(t.db, 'identities')).toBe(1);
    expect(await countRows(t.db, 'pending_identities')).toBe(0);
  });

  describe('O-12: carreras del alta', () => {
    it('alguien registra el correo con contraseña antes de completar → 409 EMAIL_TAKEN y la fila pasa a unión', async () => {
      const { identity, token } = await untilSignup();
      const registered = await registerUser(t.app, { email: identity.email });
      const response = await signup(signupBody(token));
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('EMAIL_TAKEN');
      const [row] = await t.db.select().from(pendingIdentities);
      expect(row).toMatchObject({ kind: 'link', userId: registered.userId });
      expect((await pending(token)).body.kind).toBe('link');
      expect(await countRows(t.db, 'identities')).toBe(0);
    });

    it('otra identidad crea una cuenta sin contraseña con ese correo → 409 ACCOUNT_USES_OTHER_PROVIDER y la fila se borra', async () => {
      const first = await untilSignup();
      const second = await untilSignup({ identity: { email: first.identity.email } });
      expect((await signup(signupBody(first.token))).status).toBe(201);
      const response = await signup(signupBody(second.token));
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('ACCOUNT_USES_OTHER_PROVIDER');
      expect(await countRows(t.db, 'pending_identities')).toBe(0);
    });

    it('dos altas simultáneas con el mismo subject → una 201 y la otra OAUTH_FLOW_INVALID', async () => {
      const identity = newIdentity();
      const a = await untilSignup({ identity });
      const b = await untilSignup({ identity });
      const responses = await Promise.all([
        signup(signupBody(a.token)),
        signup(signupBody(b.token)),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([201, 400]);
      const failed = responses.find((r) => r.status === 400);
      expect(failed?.body.error.code).toBe('OAUTH_FLOW_INVALID');
      expect(await countRows(t.db, 'users')).toBe(1);
      expect(await countRows(t.db, 'identities')).toBe(1);
      expect(await countRows(t.db, 'pending_identities')).toBe(0);
    });

    it('el mismo token pendiente dos veces a la vez → una 201 y la otra OAUTH_FLOW_INVALID', async () => {
      const { token } = await untilSignup();
      const responses = await Promise.all([signup(signupBody(token)), signup(signupBody(token))]);
      expect(responses.map((r) => r.status).sort()).toEqual([201, 400]);
      expect(await countRows(t.db, 'users')).toBe(1);
    });
  });

  describe('O-13: flujo inválido → 400 OAUTH_FLOW_INVALID sin crear nada', () => {
    async function expectInvalid(response: { status: number; body: { error?: { code: string } } }) {
      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe('OAUTH_FLOW_INVALID');
      for (const table of ['users', 'identities', 'sessions', 'pending_identities']) {
        expect(await countRows(t.db, table), table).toBe(0);
      }
    }

    it('flowToken inventado', async () => {
      const flow = await authorize(t.app);
      await expectInvalid(await callback(t.app, { ...flow, flowToken: 'x'.repeat(43) }));
    });

    it('state cambiado en la vuelta', async () => {
      const flow = await authorize(t.app);
      const query = new URLSearchParams(flow.callbackQuery);
      query.set('state', 'estado-manipulado');
      await expectInvalid(
        await callback(t.app, { flowToken: flow.flowToken, callbackQuery: query.toString() }),
      );
    });

    it('sin state en la vuelta', async () => {
      const flow = await authorize(t.app);
      const query = new URLSearchParams(flow.callbackQuery);
      query.delete('state');
      await expectInvalid(
        await callback(t.app, { flowToken: flow.flowToken, callbackQuery: query.toString() }),
      );
    });

    it('segundo uso del mismo flujo', async () => {
      const flow = await authorize(t.app);
      expect((await callback(t.app, flow)).body.result).toBe('signup_required');
      await t.db.delete(pendingIdentities);
      await expectInvalid(await callback(t.app, flow));
    });

    it('Clock + 11 minutos', async () => {
      const flow = await authorize(t.app);
      t.clock.advanceMinutes(11);
      await expectInvalid(await callback(t.app, flow));
      expect(await countRows(t.db, 'oauth_states')).toBe(0);
    });

    it('flowToken con formato inválido → 400 de validación', async () => {
      const flow = await authorize(t.app);
      const response = await callback(t.app, { ...flow, flowToken: 'corto' });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('O-14: fallos del proveedor', () => {
    it.each([
      'token_error',
      'wrong_nonce',
      'wrong_audience',
      'wrong_issuer',
      'expired_id_token',
      'slow_token',
    ] as const)('%s → failed provider_failed a tiempo', async (scenario) => {
      const flow = await authorize(t.app, { entryPoint: 'register', identity: { scenario } });
      const started = Date.now();
      const response = await callback(t.app, flow);
      expect(Date.now() - started).toBeLessThan(OAUTH_HTTP_TIMEOUT_MS + 1000);
      expect(response.body).toEqual({
        result: 'failed',
        reason: 'provider_failed',
        entryPoint: 'register',
        returnPath: null,
      });
      expect(await countRows(t.db, 'oauth_states')).toBe(0);
      expect(await countRows(t.db, 'pending_identities')).toBe(0);
    });

    it('cancelar en el proveedor → failed cancelled y la fila consumida', async () => {
      const flow = await authorize(t.app, { decision: 'deny', returnPath: '/account' });
      const response = await callback(t.app, flow);
      expect(response.body).toEqual({
        result: 'failed',
        reason: 'cancelled',
        entryPoint: 'login',
        returnPath: '/account',
      });
      expect(await countRows(t.db, 'oauth_states')).toBe(0);
    });
  });

  describe('O-15: estado pendiente caducado', () => {
    it('Clock + 31 min → OAUTH_FLOW_INVALID en pending y signup', async () => {
      const { token } = await untilSignup();
      t.clock.advanceMinutes(31);
      const lookup = await pending(token);
      expect(lookup.status).toBe(400);
      expect(lookup.body.error.code).toBe('OAUTH_FLOW_INVALID');
      const response = await signup(signupBody(token));
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('OAUTH_FLOW_INVALID');
      expect(await countRows(t.db, 'users')).toBe(0);
    });

    it('pending sin cabecera o con un token mal formado → OAUTH_FLOW_INVALID', async () => {
      expect((await api(t.app).get('/auth/oauth/pending')).body.error.code).toBe(
        'OAUTH_FLOW_INVALID',
      );
      expect((await pending('no-vale')).body.error.code).toBe('OAUTH_FLOW_INVALID');
    });

    it('la cancelación borra el pendiente y es idempotente', async () => {
      const { token } = await untilSignup();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await api(t.app)
          .post('/auth/oauth/pending/cancellation')
          .send({ pendingToken: token });
        expect(response.status).toBe(204);
      }
      expect(await countRows(t.db, 'pending_identities')).toBe(0);
      expect((await signup(signupBody(token))).body.error.code).toBe('OAUTH_FLOW_INVALID');
    });

    it('un pendiente de unión no sirve para el alta', async () => {
      const existing = await registerUser(t.app);
      const flow = await runFlow(t.app, { identity: { email: existing.email } });
      const response = await signup(signupBody(flow.response.body.pending.token as string));
      expect(response.body.error.code).toBe('OAUTH_FLOW_INVALID');
      expect(await countRows(t.db, 'identities')).toBe(0);
    });
  });

  it('O-20: los logs no contienen code, state, nonce, tokens, subject, correo ni secretos', async () => {
    const output: string[] = [];
    const capture = (chunk: unknown): boolean => {
      output.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(capture);
    vi.spyOn(process.stderr, 'write').mockImplementation(capture);

    const secrets: string[] = [];
    const remember = (flow: {
      flowToken: string;
      callbackQuery: string;
      authorizationUrl: string;
      identity: { subject: string; email?: string };
    }) => {
      const query = new URLSearchParams(flow.callbackQuery);
      const url = new URL(flow.authorizationUrl);
      secrets.push(
        flow.flowToken,
        flow.callbackQuery,
        flow.identity.subject,
        query.get('code') ?? 'sin-code',
        url.searchParams.get('state') ?? 'sin-state',
        url.searchParams.get('nonce') ?? 'sin-nonce',
        url.searchParams.get('code_challenge') ?? 'sin-challenge',
      );
      if (flow.identity.email) secrets.push(flow.identity.email);
    };

    // Alta completa, entrada, cancelación y fallos del proveedor.
    const first = await runFlow(t.app);
    remember(first);
    const token = first.response.body.pending.token as string;
    secrets.push(token);
    const created = await signup(signupBody(token));
    secrets.push(created.body.session.token as string, created.body.user.id as string);
    remember(
      await runFlow(t.app, {
        identity: { subject: first.identity.subject, email: first.identity.email },
      }),
    );
    remember(await runFlow(t.app, { decision: 'deny' }));
    for (const scenario of ['token_error', 'wrong_nonce', 'expired_id_token'] as const) {
      remember(await runFlow(t.app, { identity: { scenario } }));
    }
    const minor = await runFlow(t.app);
    remember(minor);
    await signup(
      signupBody(minor.response.body.pending.token as string, { birthDate: '2015-03-14' }),
    );

    vi.restoreAllMocks();
    const log = output.join('');
    expect(log).toContain('oauth_signup_completed');
    expect(log).toContain('oauth_signed_in');
    expect(log).toContain('oauth_provider_error');
    expect(log).toContain('"reason":"cancelled"');
    for (const value of [
      ...secrets,
      OAUTH_TEST_ENV.GOOGLE_CLIENT_SECRET,
      '2015-03-14',
      'id_token',
      'eyJ', // cabecera de cualquier JWT
    ]) {
      expect(log, `el log contiene «${value}»`).not.toContain(value);
    }
  });

  it('O-22: el 21.º inicio en 15 minutos desde la misma IP → 429', async () => {
    const ip = uniqueIp();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect((await startFlow(t.app, { ip })).status).toBe(201);
    }
    const blocked = await startFlow(t.app, { ip });
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('O-22: la vuelta también tiene límite por IP (20 cada 15 minutos)', async () => {
    const ip = uniqueIp();
    let last = 0;
    for (let attempt = 0; attempt < 21; attempt += 1) {
      last = (
        await callback(t.app, { flowToken: 'x'.repeat(43), callbackQuery: 'state=s' }, { ip })
      ).status;
    }
    expect(last).toBe(429);
  });
});

describe('O-21: un proveedor sin configurar no existe', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({
      override: (builder) => builder.overrideProvider(PROVIDER_CLIENTS).useValue(new Map()),
    });
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('falta en providers y da 404 al empezar y al volver', async () => {
    expect((await api(t.app).get('/auth/oauth/providers')).body).toEqual({ providers: [] });
    expect((await startFlow(t.app)).status).toBe(404);
    expect(
      (await callback(t.app, { flowToken: 'x'.repeat(43), callbackQuery: 'code=c&state=s' }))
        .status,
    ).toBe(404);
    expect(await countRows(t.db, 'oauth_states')).toBe(0);
  });
});
