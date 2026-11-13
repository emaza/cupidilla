import { beforeEach, describe, expect, it, vi } from 'vitest';

// La API se sustituye: aquí se prueba qué hace la web con cada respuesta (técnico §11.2 y §11.3).
const api = vi.hoisted(() => ({
  oauthStart: vi.fn(),
  oauthCallback: vi.fn(),
  oauthPending: vi.fn(),
  oauthCancelPending: vi.fn(),
  oauthSignup: vi.fn(),
}));
vi.mock('#lib/server/api-client.ts', () => ({ api }));

const start = await import('./[provider=provider]/+server.ts');
const back = await import('./[provider=provider]/callback/+server.ts');
const complete = await import('../(guest)/register/complete/+page.server.ts');

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
    locals: { user: options.user ?? null, sessionToken: null },
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
      '/login?error=rate-limited&provider=google',
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

  it.each([
    [failure(400, 'OAUTH_FLOW_INVALID'), '/login?error=provider-expired'],
    [failure(400, 'VALIDATION_FAILED'), '/login?error=provider-expired'],
    [failure(429, 'RATE_LIMITED'), '/login?error=rate-limited'],
    [failure(503, 'API_UNAVAILABLE'), '/login?error=provider-failed'],
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
  const pendingData = {
    kind: 'signup',
    provider: 'google',
    email: 'ana@example.com',
    entryPoint: 'register',
    expiresAt: EXPIRES,
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
