import { beforeEach, describe, expect, it, vi } from 'vitest';

// La API se sustituye: aquí se prueba qué hace la web con cada respuesta (técnico §11.2 y §11.3).
const api = vi.hoisted(() => ({
  oauthStart: vi.fn(),
  oauthCallback: vi.fn(),
  oauthPending: vi.fn(),
  oauthCancelPending: vi.fn(),
  oauthSignup: vi.fn(),
  oauthLink: vi.fn(),
  oauthSessionStart: vi.fn(),
  removeIdentity: vi.fn(),
  deleteAccount: vi.fn(),
  account: vi.fn(),
}));
vi.mock('#lib/server/api-client.ts', () => ({ api }));

const start = await import('./[provider=provider]/+server.ts');
const back = await import('./[provider=provider]/callback/+server.ts');
const complete = await import('../(guest)/register/complete/+page.server.ts');
const linkPage = await import('../(guest)/login/link/+page.server.ts');
const accountPage = await import('../(private)/account/+page.server.ts');
const passwordPage = await import('../(private)/account/password/+page.server.ts');
const deletePage = await import('../(private)/account/delete/+page.server.ts');

interface CookieJar {
  values: Map<string, string>;
  get(name: string): string | undefined;
  set(name: string, value: string, options: object): void;
  delete(name: string, options: object): void;
}

function jar(initial: Record<string, string> = {}): CookieJar {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: (name) => values.get(name),
    set: (name, value) => void values.set(name, value),
    delete: (name) => void values.delete(name),
  };
}

const FLOW = 'F'.repeat(43);
const PENDING = 'P'.repeat(43);
const SESSION = 'S'.repeat(43);
const EXPIRES = '2026-11-13T12:00:00.000Z';

function event<E>(options: {
  url?: string;
  cookies?: CookieJar;
  form?: Record<string, string>;
  user?: object | null;
  method?: string;
}): E {
  const data = new FormData();
  for (const [name, value] of Object.entries(options.form ?? {})) data.set(name, value);
  return {
    params: { provider: 'google' },
    url: new URL(options.url ?? 'http://localhost/'),
    cookies: options.cookies ?? jar(),
    locals: {
      user: options.user ?? null,
      sessionToken: options.user ? SESSION : null,
    },
    request: { method: options.method ?? 'POST', formData: () => Promise.resolve(data) },
    setHeaders: vi.fn(),
    getClientAddress: () => '127.0.0.1',
  } as unknown as E;
}

/**
 * Resuelve a lo que devuelve el manejador (una `Response` o el `fail()` de una acción) o a la
 * redirección que lanza.
 */
async function run(fn: () => unknown): Promise<{
  status?: number;
  location?: string | null;
  response?: { status: number; headers?: Headers; data?: unknown };
}> {
  try {
    const response = (await fn()) as { status: number; headers?: Headers; data?: unknown };
    if (response instanceof Response) {
      return { status: response.status, location: response.headers.get('location'), response };
    }
    return { response };
  } catch (thrown) {
    if (typeof thrown === 'object' && thrown !== null && 'location' in thrown) {
      const { status, location } = thrown as { status: number; location: string };
      return { status, location };
    }
    throw thrown;
  }
}

const ok = (data: unknown, status = 200) => ({ ok: true, status, data });
const failure = (status: number, code: string, fields?: unknown) => ({
  ok: false,
  status,
  error: { code, fields },
});

beforeEach(() => {
  vi.clearAllMocks();
});

const pendingData = {
  kind: 'signup',
  provider: 'google',
  email: 'ana@example.com',
  entryPoint: 'register',
  expiresAt: EXPIRES,
};

describe('POST /auth/{provider}: empezar', () => {
  it('pide la URL a la API, guarda el flowToken y redirige al proveedor; next pasa por la lista cerrada', async () => {
    api.oauthStart.mockResolvedValue(
      ok(
        { authorizationUrl: 'https://accounts.google.com/x', flowToken: FLOW, expiresAt: EXPIRES },
        201,
      ),
    );
    const cookies = jar();
    const result = await run(() =>
      start.POST(event({ cookies, form: { from: 'login', next: '/account/delete' } })),
    );
    expect(result).toEqual({ status: 303, location: 'https://accounts.google.com/x' });
    expect(api.oauthStart).toHaveBeenCalledWith(expect.anything(), 'google', {
      entryPoint: 'login',
      returnPath: '/account/delete',
    });
    expect(cookies.values.get('cupidilla_oauth')).toBe(FLOW);

    await run(() => start.POST(event({ form: { from: 'register', next: '//evil.example' } })));
    expect(api.oauthStart).toHaveBeenLastCalledWith(expect.anything(), 'google', {
      entryPoint: 'register',
    });
  });

  it('con sesión, a /account sin llamar a la API', async () => {
    const result = await run(() =>
      start.POST(event({ form: { from: 'login' }, user: { id: 'u' } })),
    );
    expect(result.location).toBe('/account');
    expect(api.oauthStart).not.toHaveBeenCalled();
  });

  it('si la API falla, vuelve al origen con el error; con 429, rate-limited', async () => {
    api.oauthStart.mockResolvedValue(failure(503, 'API_UNAVAILABLE'));
    expect((await run(() => start.POST(event({ form: { from: 'register' } })))).location).toBe(
      '/register?error=provider-failed&provider=google',
    );
    api.oauthStart.mockResolvedValue(failure(429, 'RATE_LIMITED'));
    expect((await run(() => start.POST(event({ form: { from: 'login' } })))).location).toBe(
      '/login?error=rate-limited',
    );
  });

  it('un from desconocido → 400', async () => {
    await expect(start.POST(event({ form: { from: 'otra' } }))).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('W-O3: GET /auth/{provider}/callback', () => {
  const callbackEvent = (
    cookies: CookieJar,
    query = '?code=abc%2B1&state=xyz&iss=https%3A%2F%2Fa',
  ) =>
    event<Parameters<typeof back.GET>[0]>({
      url: `http://localhost/auth/google/callback${query}`,
      cookies,
      method: 'GET',
    });

  it('sin cookie no llama a la API, va a provider-expired y con no-store', async () => {
    const result = await run(() => back.GET(callbackEvent(jar())));
    expect(result.location).toBe('/login?error=provider-expired');
    expect(result.response?.headers?.get('cache-control')).toBe('no-store');
    expect(api.oauthCallback).not.toHaveBeenCalled();
  });

  it('reenvía la consulta tal cual, sin el «?»', async () => {
    api.oauthCallback.mockResolvedValue(failure(400, 'OAUTH_FLOW_INVALID'));
    await run(() => back.GET(callbackEvent(jar({ cupidilla_oauth: FLOW }))));
    expect(api.oauthCallback).toHaveBeenCalledWith(
      expect.anything(),
      'google',
      { flowToken: FLOW, callbackQuery: 'code=abc%2B1&state=xyz&iss=https%3A%2F%2Fa' },
      undefined,
    );
  });

  it.each([
    [
      'signed_in',
      {
        result: 'signed_in',
        user: {},
        session: { token: SESSION, expiresAt: EXPIRES },
        returnPath: '/account/delete',
      },
      '/account/delete',
    ],
    [
      'signed_in con returnPath fuera de lista',
      {
        result: 'signed_in',
        user: {},
        session: { token: SESSION, expiresAt: EXPIRES },
        returnPath: '/otra',
      },
      '/account',
    ],
    [
      'signup_required',
      { result: 'signup_required', pending: { token: PENDING, expiresAt: EXPIRES } },
      '/register/complete',
    ],
    [
      'link_required',
      { result: 'link_required', pending: { token: PENDING, expiresAt: EXPIRES } },
      '/login/link',
    ],
    [
      'use_other_provider',
      { result: 'use_other_provider', providers: ['facebook', 'google'] },
      '/login?error=other-provider&provider=facebook',
    ],
    [
      'failed cancelled',
      { result: 'failed', reason: 'cancelled', entryPoint: 'register', returnPath: null },
      '/register?notice=provider-cancelled&provider=google',
    ],
    [
      'failed email_unverified',
      { result: 'failed', reason: 'email_unverified', entryPoint: 'login', returnPath: null },
      '/login?error=email-unverified&provider=google',
    ],
    [
      'failed connect_refused',
      {
        result: 'failed',
        reason: 'connect_refused',
        entryPoint: 'account',
        returnPath: '/account',
      },
      '/account?error=connect-refused&provider=google',
    ],
    [
      'failed email_missing desde /account',
      { result: 'failed', reason: 'email_missing', entryPoint: 'account', returnPath: '/account' },
      '/account?error=email-missing&provider=google',
    ],
    ['password_created', { result: 'password_created' }, '/account?notice=password-created'],
  ])('%s → %s', async (_case, data, location) => {
    api.oauthCallback.mockResolvedValue(ok(data));
    const cookies = jar({ cupidilla_oauth: FLOW });
    const result = await run(() => back.GET(callbackEvent(cookies)));
    expect(result.location).toBe(location);
    expect(result.response?.headers?.get('cache-control')).toBe('no-store');
    const isPending = location === '/register/complete' || location === '/login/link';
    expect(cookies.values.get('cupidilla_oauth')).toBe(isPending ? PENDING : undefined);
    expect(cookies.values.get('cupidilla_session')).toBe(
      _case.startsWith('signed_in') ? SESSION : undefined,
    );
  });

  it('connect_confirmed → al proveedor nuevo con el flujo siguiente en la cookie (decisión 21)', async () => {
    const NEXT = 'N'.repeat(43);
    api.oauthCallback.mockResolvedValue(
      ok({
        result: 'connect_confirmed',
        next: {
          authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=s',
          flowToken: NEXT,
          expiresAt: EXPIRES,
        },
      }),
    );
    const cookies = jar({ cupidilla_oauth: FLOW });
    const result = await run(() =>
      back.GET(
        event<Parameters<typeof back.GET>[0]>({
          url: 'http://localhost/auth/facebook/callback?code=x&state=s',
          cookies,
          method: 'GET',
          user: { id: 'u' },
        }),
      ),
    );
    expect(result.status).toBe(303);
    expect(result.location).toBe('https://accounts.google.com/o/oauth2/v2/auth?state=s');
    expect(result.response?.headers?.get('cache-control')).toBe('no-store');
    expect(cookies.values.get('cupidilla_oauth')).toBe(NEXT);
  });

  it('flujo caducado con sesión → /account?error=confirm-expired (decisión 21)', async () => {
    api.oauthCallback.mockResolvedValue(failure(400, 'OAUTH_FLOW_INVALID'));
    const cookies = jar({ cupidilla_oauth: FLOW });
    const result = await run(() =>
      back.GET(
        event<Parameters<typeof back.GET>[0]>({
          url: 'http://localhost/auth/google/callback?code=x&state=s',
          cookies,
          method: 'GET',
          user: { id: 'u' },
        }),
      ),
    );
    expect(result.location).toBe('/account?error=confirm-expired&provider=google');
    expect(cookies.values.has('cupidilla_oauth')).toBe(false);
  });

  it.each([
    [failure(400, 'OAUTH_FLOW_INVALID'), '/login?error=provider-expired'],
    [failure(400, 'VALIDATION_FAILED'), '/login?error=provider-expired'],
    [failure(429, 'RATE_LIMITED'), '/login?error=rate-limited'],
    [failure(503, 'API_UNAVAILABLE'), '/login?error=provider-failed&provider=google'],
  ])('error de la API → %j', async (response, location) => {
    api.oauthCallback.mockResolvedValue(response);
    const cookies = jar({ cupidilla_oauth: FLOW });
    expect((await run(() => back.GET(callbackEvent(cookies)))).location).toBe(location);
    expect(cookies.values.has('cupidilla_oauth')).toBe(false);
  });
});

describe('/register/complete', () => {
  const adult = {
    day: '5',
    month: '5',
    year: '1990',
    acceptTerms: 'on',
    termsVersion: '2026-11-borrador',
  };
  const pendingLookup = ok(pendingData);

  it('load: sin cookie → provider-expired; con un pendiente de unión → /login/link', async () => {
    expect((await run(() => complete.load(event({ method: 'GET' })))).location).toBe(
      '/login?error=provider-expired',
    );
    api.oauthPending.mockResolvedValue(ok({ ...pendingData, kind: 'link' }));
    expect(
      (
        await run(() =>
          complete.load(event({ method: 'GET', cookies: jar({ cupidilla_oauth: PENDING }) })),
        )
      ).location,
    ).toBe('/login/link');
  });

  it('load tras un POST: sin cookie (menor) no redirige; con cookie y estado caducado, provider-expired', async () => {
    const afterUnderage = await run(() => complete.load(event({ method: 'POST' })));
    expect(afterUnderage.response).toMatchObject({ pending: null });
    api.oauthPending.mockResolvedValue(failure(400, 'OAUTH_FLOW_INVALID'));
    const expired = await run(() =>
      complete.load(event({ method: 'POST', cookies: jar({ cupidilla_oauth: PENDING }) })),
    );
    expect(expired.location).toBe('/login?error=provider-expired');
  });

  it('menor: si la cancelación falla, se reintenta una vez y la pantalla de menor sale igual', async () => {
    api.oauthPending.mockResolvedValue(pendingLookup);
    api.oauthCancelPending.mockResolvedValue(failure(503, 'API_UNAVAILABLE'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cookies = jar({ cupidilla_oauth: PENDING });
    const result = await run(() =>
      complete.actions.signup(event({ cookies, form: { ...adult, year: '2015' } })),
    );
    expect(api.oauthCancelPending).toHaveBeenCalledTimes(2);
    expect(result.response).toMatchObject({ status: 422, data: { underage: true } });
    expect(cookies.values.has('cupidilla_oauth')).toBe(false);
    expect(errorLog.mock.calls.join(' ')).not.toContain(PENDING);
    errorLog.mockRestore();
  });

  it('alta correcta: cookie de sesión, borra cupidilla_oauth y va a returnPath o /account', async () => {
    api.oauthSignup.mockResolvedValue(
      ok({ user: {}, session: { token: SESSION, expiresAt: EXPIRES }, returnPath: null }, 201),
    );
    const cookies = jar({ cupidilla_oauth: PENDING });
    const result = await run(() => complete.actions.signup(event({ cookies, form: adult })));
    expect(result.location).toBe('/account');
    expect(api.oauthSignup).toHaveBeenCalledWith(expect.anything(), {
      pendingToken: PENDING,
      birthDate: '1990-05-05',
      acceptTerms: true,
      termsVersion: '2026-11-borrador',
    });
    expect(cookies.values.get('cupidilla_session')).toBe(SESSION);
    expect(cookies.values.has('cupidilla_oauth')).toBe(false);
  });

  it('menor: no llama al alta, cancela el pendiente, borra la cookie y no devuelve valores', async () => {
    api.oauthPending.mockResolvedValue(pendingLookup);
    const cookies = jar({ cupidilla_oauth: PENDING });
    const result = await run(() =>
      complete.actions.signup(event({ cookies, form: { ...adult, year: '2015' } })),
    );
    expect(api.oauthSignup).not.toHaveBeenCalled();
    expect(api.oauthCancelPending).toHaveBeenCalledWith(expect.anything(), PENDING);
    expect(cookies.values.has('cupidilla_oauth')).toBe(false);
    expect(result.response).toMatchObject({
      status: 422,
      data: { underage: true, provider: 'google' },
    });
  });

  it.each([
    [failure(400, 'OAUTH_FLOW_INVALID'), '/login?error=provider-expired', false],
    [failure(409, 'EMAIL_TAKEN'), '/login/link', true],
    [failure(409, 'ACCOUNT_USES_OTHER_PROVIDER'), '/login?error=other-provider', false],
  ])('%j → %s', async (response, location, keepsCookie) => {
    api.oauthSignup.mockResolvedValue(response);
    const cookies = jar({ cupidilla_oauth: PENDING });
    expect(
      (await run(() => complete.actions.signup(event({ cookies, form: adult })))).location,
    ).toBe(location);
    expect(cookies.values.has('cupidilla_oauth')).toBe(keepsCookie);
  });

  it('resultado incierto: error general propio y los valores se conservan', async () => {
    api.oauthSignup.mockResolvedValue(failure(503, 'OUTCOME_UNKNOWN'));
    const result = await run(() =>
      complete.actions.signup(event({ cookies: jar({ cupidilla_oauth: PENDING }), form: adult })),
    );
    expect(result.response).toMatchObject({
      status: 503,
      data: {
        values: { day: '5', acceptTerms: true },
        errors: { general: 'alta.error.resultado_incierto' },
      },
    });
  });

  it('cancelar: borra el pendiente y vuelve a la página de origen con signup-cancelled', async () => {
    api.oauthPending.mockResolvedValue(pendingLookup);
    const cookies = jar({ cupidilla_oauth: PENDING });
    expect((await run(() => complete.actions.cancel(event({ cookies })))).location).toBe(
      '/register?notice=signup-cancelled',
    );
    expect(api.oauthCancelPending).toHaveBeenCalledWith(expect.anything(), PENDING);
    expect(cookies.values.has('cupidilla_oauth')).toBe(false);
  });
});

describe('/login/link', () => {
  const linkPending = ok({
    kind: 'link',
    provider: 'facebook',
    email: 'ana@example.com',
    entryPoint: 'login',
    expiresAt: EXPIRES,
  });
  const submit = (cookies: CookieJar, password = 'una frase larga') =>
    run(() => linkPage.actions.link(event({ cookies, form: { password } })));

  it('envía el correo que dio la API y, si acierta, va a returnPath con el aviso «unidas»', async () => {
    api.oauthPending.mockResolvedValue(linkPending);
    api.oauthLink.mockResolvedValue(
      ok({
        user: {},
        session: { token: SESSION, expiresAt: EXPIRES },
        returnPath: '/account/delete',
      }),
    );
    const cookies = jar({ cupidilla_oauth: PENDING });
    expect((await submit(cookies)).location).toBe(
      '/account/delete?notice=linked&provider=facebook',
    );
    expect(api.oauthLink).toHaveBeenCalledWith(expect.anything(), {
      pendingToken: PENDING,
      email: 'ana@example.com',
      password: 'una frase larga',
    });
    expect(cookies.values.get('cupidilla_session')).toBe(SESSION);
    expect(cookies.values.has('cupidilla_oauth')).toBe(false);
  });

  it('contraseña vacía: error en el campo sin llamar a la API', async () => {
    const result = await submit(jar({ cupidilla_oauth: PENDING }), '');
    expect(result.response).toMatchObject({
      status: 400,
      data: { errors: { fields: { password: 'union.error.contrasena_vacia' } } },
    });
    expect(api.oauthLink).not.toHaveBeenCalled();
  });

  it('contraseña incorrecta: error en el campo y el estado sigue', async () => {
    api.oauthPending.mockResolvedValue(linkPending);
    api.oauthLink.mockResolvedValue(failure(403, 'PASSWORD_INCORRECT'));
    const cookies = jar({ cupidilla_oauth: PENDING });
    expect((await submit(cookies)).response).toMatchObject({
      status: 403,
      data: { errors: { fields: { password: 'union.error.contrasena' } } },
    });
    expect(cookies.values.get('cupidilla_oauth')).toBe(PENDING);
  });

  it.each([
    [failure(403, 'LINK_ATTEMPTS_EXCEEDED'), '/login?error=link-limit'],
    [failure(400, 'OAUTH_FLOW_INVALID'), '/login?error=provider-expired'],
  ])('%j → %s y borra la cookie', async (response, location) => {
    api.oauthPending.mockResolvedValue(linkPending);
    api.oauthLink.mockResolvedValue(response);
    const cookies = jar({ cupidilla_oauth: PENDING });
    expect((await submit(cookies)).location).toBe(location);
    expect(cookies.values.has('cupidilla_oauth')).toBe(false);
  });

  it('resultado incierto y límite: error general', async () => {
    api.oauthPending.mockResolvedValue(linkPending);
    api.oauthLink.mockResolvedValue(failure(503, 'OUTCOME_UNKNOWN'));
    expect((await submit(jar({ cupidilla_oauth: PENDING }))).response).toMatchObject({
      data: { errors: { general: 'union.error.resultado_incierto' } },
    });
    api.oauthLink.mockResolvedValue(failure(429, 'RATE_LIMITED'));
    expect((await submit(jar({ cupidilla_oauth: PENDING }))).response).toMatchObject({
      status: 429,
      data: { errors: { general: 'comun.error.limite' } },
    });
  });

  it('load: con un pendiente de alta → /register/complete; sin cookie → provider-expired', async () => {
    api.oauthPending.mockResolvedValue(ok({ ...pendingData, kind: 'signup' }));
    expect(
      (
        await run(() =>
          linkPage.load(event({ method: 'GET', cookies: jar({ cupidilla_oauth: PENDING }) })),
        )
      ).location,
    ).toBe('/register/complete');
    expect((await run(() => linkPage.load(event({ method: 'GET' })))).location).toBe(
      '/login?error=provider-expired',
    );
  });

  it('cancelar: borra el pendiente y vuelve a /login con link-cancelled', async () => {
    const cookies = jar({ cupidilla_oauth: PENDING });
    expect((await run(() => linkPage.actions.cancel(event({ cookies })))).location).toBe(
      '/login?notice=link-cancelled',
    );
    expect(api.oauthCancelPending).toHaveBeenCalledWith(expect.anything(), PENDING);
  });
});

describe('/account: formas de entrar (fase 5)', () => {
  const signedIn = { id: 'u' };

  it('POST /auth/{provider} desde /account: con sesión, pide el flujo con sesión y next', async () => {
    api.oauthSessionStart.mockResolvedValue(
      ok(
        { authorizationUrl: 'https://www.facebook.com/x', flowToken: FLOW, expiresAt: EXPIRES },
        201,
      ),
    );
    const cookies = jar();
    const result = await run(() =>
      start.POST(
        event({
          cookies,
          user: signedIn,
          form: { from: 'account', intent: 'connect', next: '/account' },
        }),
      ),
    );
    expect(result.location).toBe('https://www.facebook.com/x');
    expect(api.oauthSessionStart).toHaveBeenCalledWith(expect.anything(), SESSION, 'google', {
      purpose: 'connect',
      returnPath: '/account',
    });
    expect(cookies.values.get('cupidilla_oauth')).toBe(FLOW);
  });

  it('desde /account sin sesión → /login?next; un intent desconocido → 400', async () => {
    expect(
      (
        await run(() =>
          start.POST(
            event({ form: { from: 'account', intent: 'reauthenticate', next: '/account/delete' } }),
          ),
        )
      ).location,
    ).toBe('/login?next=/account/delete');
    await expect(
      start.POST(event({ user: signedIn, form: { from: 'account', intent: 'otra' } })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('quitar: 204 → unlinked; 409 → last-method; otro error → error general con el proveedor', async () => {
    const remove = () =>
      run(() =>
        accountPage.actions.removeIdentity(
          event({ user: signedIn, form: { provider: 'facebook' } }),
        ),
      );
    api.removeIdentity.mockResolvedValue({ ok: true, status: 204, data: undefined });
    expect((await remove()).location).toBe('/account?notice=unlinked&provider=facebook');
    // Sin contraseña en la cuenta no se envía ninguna.
    expect(api.removeIdentity).toHaveBeenLastCalledWith(expect.anything(), SESSION, 'facebook', {});
    api.removeIdentity.mockResolvedValue(failure(409, 'LAST_SIGN_IN_METHOD'));
    expect((await remove()).location).toBe('/account?error=last-method&provider=facebook');
    api.removeIdentity.mockResolvedValue(failure(503, 'API_UNAVAILABLE'));
    expect((await remove()).response).toMatchObject({
      status: 503,
      data: { removeFailed: 'facebook' },
    });
  });

  it('quitar con contraseña en la cuenta: vacía no llama a la API; errónea, en el campo (decisión 20)', async () => {
    const remove = (password: string) =>
      run(() =>
        accountPage.actions.removeIdentity(
          event({ user: signedIn, form: { provider: 'google', withPassword: '1', password } }),
        ),
      );
    expect((await remove('')).response).toMatchObject({
      status: 400,
      data: { removeError: { provider: 'google', password: 'cuenta.error.contrasena_vacia' } },
    });
    expect(api.removeIdentity).not.toHaveBeenCalled();
    api.removeIdentity.mockResolvedValue(failure(403, 'PASSWORD_INCORRECT'));
    expect((await remove('una frase mala')).response).toMatchObject({
      status: 403,
      data: { removeError: { provider: 'google', password: 'cuenta.error.contrasena' } },
    });
    api.removeIdentity.mockResolvedValue({ ok: true, status: 204, data: undefined });
    expect((await remove('una frase larga')).location).toBe(
      '/account?notice=unlinked&provider=google',
    );
    expect(api.removeIdentity).toHaveBeenLastCalledWith(expect.anything(), SESSION, 'google', {
      password: 'una frase larga',
    });
  });

  it('añadir con contraseña en la cuenta: la reenvía; vacía o errónea vuelve sin ir al proveedor', async () => {
    const add = (password: string) =>
      run(() =>
        start.POST(
          event({
            user: signedIn,
            form: {
              from: 'account',
              intent: 'connect',
              next: '/account',
              withPassword: '1',
              password,
            },
          }),
        ),
      );
    expect((await add('')).location).toBe('/account?error=password-required');
    expect(api.oauthSessionStart).not.toHaveBeenCalled();
    api.oauthSessionStart.mockResolvedValue(failure(403, 'PASSWORD_INCORRECT'));
    expect((await add('una frase mala')).location).toBe('/account?error=password-incorrect');
    api.oauthSessionStart.mockResolvedValue(
      ok(
        { authorizationUrl: 'https://www.facebook.com/x', flowToken: FLOW, expiresAt: EXPIRES },
        201,
      ),
    );
    expect((await add('una frase larga')).location).toBe('https://www.facebook.com/x');
    expect(api.oauthSessionStart).toHaveBeenLastCalledWith(expect.anything(), SESSION, 'google', {
      purpose: 'connect',
      returnPath: '/account',
      password: 'una frase larga',
    });
  });

  it('crear contraseña (decisión 21): validación local, va al proveedor unido, ya creada', async () => {
    const cookies = jar();
    const create = (password: string, provider = 'google') =>
      run(() =>
        passwordPage.actions.create(
          event({ cookies, user: signedIn, form: { password, provider } }),
        ),
      );
    expect((await create('corta')).response).toMatchObject({
      status: 400,
      data: { errors: { password: 'registro.error.contrasena_corta' } },
    });
    expect(api.oauthSessionStart).not.toHaveBeenCalled();
    await expect(
      passwordPage.actions.create(
        event({ user: signedIn, form: { password: 'una frase larga', provider: 'x' } }),
      ),
    ).rejects.toMatchObject({ status: 400 });

    api.oauthSessionStart.mockResolvedValue(
      ok(
        { authorizationUrl: 'https://accounts.google.com/x', flowToken: FLOW, expiresAt: EXPIRES },
        201,
      ),
    );
    expect((await create('una frase larga')).location).toBe('https://accounts.google.com/x');
    expect(api.oauthSessionStart).toHaveBeenLastCalledWith(expect.anything(), SESSION, 'google', {
      purpose: 'create_password',
      password: 'una frase larga',
      returnPath: '/account/password',
    });
    expect(cookies.values.get('cupidilla_oauth')).toBe(FLOW);

    api.oauthSessionStart.mockResolvedValue(failure(409, 'PASSWORD_ALREADY_SET'));
    expect((await create('una frase larga')).location).toBe('/account');
    api.oauthSessionStart.mockResolvedValue(failure(429, 'RATE_LIMITED'));
    expect((await create('una frase larga')).response).toMatchObject({
      status: 429,
      data: { errors: { general: 'comun.error.limite' } },
    });
    api.oauthSessionStart.mockResolvedValue(failure(503, 'API_UNAVAILABLE'));
    expect((await create('una frase larga')).response).toMatchObject({
      data: { errors: { general: 'contrasena.error.servidor' } },
    });
  });

  it('borrar sin contraseña: ELIMINAR en cualquier caja; otra palabra no llama a la API', async () => {
    const confirm = (confirmation: string) =>
      run(() => deletePage.actions.confirm(event({ user: signedIn, form: { confirmation } })));
    expect((await confirm('borrar')).response).toMatchObject({
      status: 400,
      data: { errors: { fields: { confirmation: 'eliminar.error.confirmacion' } } },
    });
    expect(api.deleteAccount).not.toHaveBeenCalled();
    api.deleteAccount.mockResolvedValue({ ok: true, status: 204, data: undefined });
    expect((await confirm('  eliminar ')).location).toBe('/?notice=account-deleted');
    expect(api.deleteAccount).toHaveBeenCalledWith(expect.anything(), SESSION, {});
    api.deleteAccount.mockResolvedValue(failure(503, 'OUTCOME_UNKNOWN'));
    expect((await confirm('ELIMINAR')).response).toMatchObject({
      data: { errors: { general: 'eliminar.error.resultado_incierto_proveedor' } },
    });
  });
});
