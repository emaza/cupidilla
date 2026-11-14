import {
  DEFAULT_MIN_AGE,
  latestAdultBirthDate,
  referenceToday,
  SERVICE_TERMS_VERSION,
} from '@cupidilla/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// La puerta a la API y la cookie se sustituyen: aquí se prueba qué hace cada acción con cada respuesta.
const api = vi.hoisted(() => ({
  register: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  deleteAccount: vi.fn(),
  session: vi.fn(),
  account: vi.fn(),
  requestEmailVerification: vi.fn(),
  inspectEmailToken: vi.fn(),
  verifyEmail: vi.fn(),
}));
const cookie = vi.hoisted(() => ({ set: vi.fn(), clear: vi.fn() }));

vi.mock('#lib/server/api-client.ts', () => ({ api }));
vi.mock('#lib/server/min-age.ts', () => ({ currentMinAge: () => Promise.resolve(18) }));
vi.mock('#lib/server/session-cookie.ts', () => ({
  setSessionCookie: cookie.set,
  clearSessionCookie: cookie.clear,
  getSessionToken: vi.fn(),
}));

const registerPage = await import('./(guest)/register/+page.server.ts');
const loginPage = await import('./(guest)/login/+page.server.ts');
const accountPage = await import('./(private)/account/+page.server.ts');
const deletePage = await import('./(private)/account/delete/+page.server.ts');
const verifyPage = await import('./verify-email/+page.server.ts');

const TERMS = SERVICE_TERMS_VERSION;

/** Cookies en memoria: guardan el valor y las opciones de la última escritura. */
function fakeCookies(initial: Record<string, string> = {}) {
  const jar = new Map<string, { value: string; options: Record<string, unknown> }>(
    Object.entries(initial).map(([name, value]) => [name, { value, options: {} }]),
  );
  return {
    jar,
    get: (name: string) => jar.get(name)?.value,
    set: (name: string, value: string, options: Record<string, unknown>) =>
      jar.set(name, { value, options }),
    delete: (name: string) => jar.delete(name),
  };
}

let cookies = fakeCookies();

/** Evento de SvelteKit mínimo con un formulario. `E` lo fija el tipo que espera cada acción. */
function formEvent<E>(
  fields: Record<string, string>,
  locals: Record<string, unknown> = {},
  url = 'http://localhost/',
): E {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return {
    request: { formData: () => Promise.resolve(data) },
    cookies,
    locals: { user: null, sessionToken: null, ...locals },
    url: new URL(url),
    getClientAddress: () => '127.0.0.1',
  } as unknown as E;
}

const apiFailure = (status: number, code: string, fields?: unknown) => ({
  ok: false,
  status,
  error: { code, fields },
});

/** Resuelve a lo que devuelve la acción, o a la redirección que lanza. */
async function run(
  action: () => Promise<unknown>,
): Promise<{ result?: unknown; redirect?: unknown }> {
  try {
    return { result: await action() };
  } catch (thrown) {
    if (typeof thrown === 'object' && thrown !== null && 'location' in thrown) {
      const { status, location } = thrown as { status: number; location: string };
      return { redirect: { status, location } };
    }
    throw thrown;
  }
}

const adultForm = {
  email: 'ana@example.com',
  password: 'una frase larga de prueba',
  day: '5',
  month: '5',
  year: '1990',
  acceptTerms: 'on',
  termsVersion: TERMS,
};

beforeEach(() => {
  vi.clearAllMocks();
  cookies = fakeCookies();
});

describe('registro: respuestas de la API (criterios 31 y 32)', () => {
  const submit = (fields: Record<string, string> = adultForm) =>
    run(() => registerPage.actions.default(formEvent(fields)) as Promise<unknown>);

  it('429 → comun.error.limite, con los valores conservados y sin la contraseña', async () => {
    api.register.mockResolvedValue(apiFailure(429, 'RATE_LIMITED'));
    const { result } = await submit();
    expect(result).toMatchObject({
      status: 429,
      data: {
        errors: { fields: {}, general: 'comun.error.limite' },
        values: { email: 'ana@example.com', day: '5', month: '5', year: '1990', acceptTerms: true },
      },
    });
    expect(JSON.stringify(result)).not.toContain('una frase larga de prueba');
  });

  it('API caída → registro.error.servidor, con los valores conservados y sin detalles técnicos', async () => {
    api.register.mockResolvedValue(apiFailure(503, 'API_UNAVAILABLE'));
    const { result } = await submit();
    expect(result).toMatchObject({
      status: 503,
      data: {
        errors: { general: 'registro.error.servidor' },
        values: { email: 'ana@example.com', acceptTerms: true },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/API_UNAVAILABLE|ECONN|fetch/);
  });

  it('resultado incierto → 503 con registro.error.resultado_incierto, sin cookie y sin la contraseña (criterios 60 y 61)', async () => {
    api.register.mockResolvedValue(apiFailure(503, 'OUTCOME_UNKNOWN'));
    const { result, redirect } = await submit();
    expect(redirect).toBeUndefined();
    expect(result).toMatchObject({
      status: 503,
      data: {
        errors: { fields: {}, dateParts: [], general: 'registro.error.resultado_incierto' },
        values: { email: 'ana@example.com', day: '5', month: '5', year: '1990', acceptTerms: true },
      },
    });
    expect(api.register).toHaveBeenCalledOnce();
    expect(cookie.set).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/una frase larga de prueba|OUTCOME_UNKNOWN/);
  });

  it('una respuesta 500 de la API también es registro.error.servidor', async () => {
    api.register.mockResolvedValue(apiFailure(500, 'INTERNAL_ERROR'));
    expect((await submit()).result).toMatchObject({
      data: { errors: { general: 'registro.error.servidor' } },
    });
  });

  it.each(['ana@example.com', 'nadie@example.com'])(
    'B7-4: con 202 (%s): 303 a /register/check-email con el correo en cupidilla_pending_email y sin sesión',
    async (email) => {
      api.register.mockResolvedValue({ ok: true, status: 202, data: undefined });
      const outcome = await submit({ ...adultForm, email });
      expect(outcome.redirect).toEqual({ status: 303, location: '/register/check-email' });
      expect(cookies.jar.get('cupidilla_pending_email')).toEqual({
        value: `signup:${email}`,
        options: expect.objectContaining({ path: '/', httpOnly: true, sameSite: 'lax' }),
      });
      expect(cookie.set).not.toHaveBeenCalled();
    },
  );

  it('un menor: pantalla de cierre sin ningún valor y sin llamar a la API', async () => {
    const latest = latestAdultBirthDate(referenceToday(new Date()), DEFAULT_MIN_AGE);
    const [year, month, day] = latest.split('-').map(Number) as [number, number, number];
    const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
    const { result } = await submit({
      ...adultForm,
      day: String(tomorrow.getUTCDate()),
      month: String(tomorrow.getUTCMonth() + 1),
      year: String(tomorrow.getUTCFullYear()),
      password: 'x',
      acceptTerms: '',
    });
    expect(result).toMatchObject({ status: 422, data: { underage: true } });
    expect(Object.keys((result as { data: object }).data)).toEqual(['underage']);
    expect(api.register).not.toHaveBeenCalled();
  });

  it('si la API dice UNDERAGE (relojes distintos) se trata igual: sin valores', async () => {
    api.register.mockResolvedValue(apiFailure(422, 'UNDERAGE'));
    const { result } = await submit();
    expect(result).toMatchObject({ status: 422 });
    expect(Object.keys((result as { data: object }).data)).toEqual(['underage']);
  });

  it('versión de condiciones caducada: la casilla vuelve desmarcada', async () => {
    api.register.mockResolvedValue(apiFailure(409, 'TERMS_VERSION_OUTDATED'));
    const { result } = await submit();
    expect(result).toMatchObject({
      status: 409,
      data: {
        values: { acceptTerms: false, email: 'ana@example.com' },
        errors: { fields: { acceptTerms: 'registro.error.condiciones_version' } },
      },
    });
  });

  it('una versión de condiciones manipulada en el formulario llega a la API tal cual (ella decide)', async () => {
    api.register.mockResolvedValue(apiFailure(409, 'TERMS_VERSION_OUTDATED'));
    await submit({ ...adultForm, termsVersion: 'inventada' });
    expect(api.register).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ termsVersion: 'inventada', acceptTerms: true }),
    );
  });

  it('sin casilla marcada no se llama a la API', async () => {
    const { result } = await submit({ ...adultForm, acceptTerms: '' });
    expect(result).toMatchObject({
      status: 400,
      data: { errors: { fields: { acceptTerms: 'registro.error.condiciones' } } },
    });
    expect(api.register).not.toHaveBeenCalled();
  });
});

describe('entrar: respuestas de la API (criterios 31, 32, 8 y 10)', () => {
  const submit = (fields: Record<string, string> = {}) =>
    run(
      () =>
        loginPage.actions.default(
          formEvent({ email: 'ana@example.com', password: 'una frase larga', ...fields }),
        ) as Promise<unknown>,
    );
  const ok = {
    ok: true,
    status: 200,
    data: { user: {}, session: { token: 'T', expiresAt: '2026-12-11T00:00:00.000Z' } },
  };

  it('429 → comun.error.limite', async () => {
    api.login.mockResolvedValue(apiFailure(429, 'RATE_LIMITED'));
    expect((await submit()).result).toMatchObject({
      status: 429,
      data: { errors: { general: 'comun.error.limite' }, values: { email: 'ana@example.com' } },
    });
  });

  it('OUTCOME_UNKNOWN de la API en el login → entrar.error.servidor, nunca resultado incierto (criterio 65)', async () => {
    api.login.mockResolvedValue(apiFailure(503, 'OUTCOME_UNKNOWN'));
    expect((await submit()).result).toMatchObject({
      status: 503,
      data: { errors: { general: 'entrar.error.servidor' } },
    });
  });

  it('API caída → entrar.error.servidor', async () => {
    api.login.mockResolvedValue(apiFailure(503, 'API_UNAVAILABLE'));
    expect((await submit()).result).toMatchObject({
      status: 503,
      data: { errors: { general: 'entrar.error.servidor' } },
    });
  });

  it('un 502 sin cuerpo de un proxy (API_UNAVAILABLE 502) → entrar.error.servidor', async () => {
    api.login.mockResolvedValue(apiFailure(502, 'API_UNAVAILABLE'));
    expect((await submit()).result).toMatchObject({
      status: 502,
      data: { errors: { general: 'entrar.error.servidor' } },
    });
  });

  it('credenciales incorrectas y validación de la API dan el mismo texto genérico', async () => {
    api.login.mockResolvedValue(apiFailure(401, 'INVALID_CREDENTIALS'));
    const wrong = await submit();
    api.login.mockResolvedValue(apiFailure(400, 'VALIDATION_FAILED'));
    const invalid = await submit();
    for (const { result } of [wrong, invalid]) {
      expect(result).toMatchObject({ data: { errors: { general: 'entrar.error.credenciales' } } });
    }
  });

  it('un correo mal formado no llega a la API', async () => {
    const { result } = await submit({ email: 'no es un correo' });
    expect(result).toMatchObject({ data: { errors: { general: 'entrar.error.credenciales' } } });
    expect(api.login).not.toHaveBeenCalled();
  });

  it.each([
    ['/account/delete', '/account/delete'],
    ['/account', '/account'],
    ['https://otro.sitio', '/account'],
    ['//otro.sitio', '/account'],
    ['/\\otro.sitio', '/account'],
    ['javascript:alert(1)', '/account'],
    ['', '/account'],
  ])('next=%j → redirige a %s', async (next, expected) => {
    api.login.mockResolvedValue(ok);
    const outcome = await submit({ next });
    expect(outcome.redirect).toEqual({ status: 303, location: expected });
  });
});

describe('/account: salir (acuerdo A14)', () => {
  const signedIn = { user: { id: 'u', email: 'ana@example.com' }, sessionToken: 'T'.repeat(43) };
  const submitLogout = () =>
    run(() => accountPage.actions.logout(formEvent({}, signedIn)) as Promise<unknown>);

  it('204: borra la cookie y vuelve a la portada con el aviso', async () => {
    api.logout.mockResolvedValue({ ok: true, status: 204, data: undefined });
    expect((await submitLogout()).redirect).toEqual({
      status: 303,
      location: '/?notice=signed-out',
    });
    expect(cookie.clear).toHaveBeenCalledOnce();
  });

  it('401 (la sesión ya no existe): también sale', async () => {
    api.logout.mockResolvedValue(apiFailure(401, 'UNAUTHENTICATED'));
    expect((await submitLogout()).redirect).toEqual({
      status: 303,
      location: '/?notice=signed-out',
    });
    expect(cookie.clear).toHaveBeenCalledOnce();
  });

  it.each([
    ['la API no responde', apiFailure(503, 'API_UNAVAILABLE')],
    ['la API da OUTCOME_UNKNOWN', apiFailure(503, 'OUTCOME_UNKNOWN')],
    ['la API da 500', apiFailure(500, 'INTERNAL_ERROR')],
  ])('%s: NO borra la cookie y muestra cuenta.error.servidor', async (_, failure) => {
    api.logout.mockResolvedValue(failure);
    const { result, redirect } = await submitLogout();
    expect(redirect).toBeUndefined();
    expect(result).toMatchObject({ status: 503, data: { general: 'cuenta.error.servidor' } });
    expect(cookie.clear).not.toHaveBeenCalled();
  });
});

describe('/account: reenviar la verificación (B7-7)', () => {
  const submitResend = (user: Record<string, unknown>) =>
    run(
      () =>
        accountPage.actions.resendVerification(
          formEvent({}, { user, sessionToken: 'T'.repeat(43) }),
        ) as Promise<unknown>,
    );

  it('con el correo ya confirmado no llama a la API: verification-already', async () => {
    const outcome = await submitResend({ id: 'u', email: 'ana@example.com', emailVerified: true });
    expect(outcome.redirect).toEqual({
      status: 303,
      location: '/account?notice=verification-already',
    });
    expect(api.requestEmailVerification).not.toHaveBeenCalled();
  });

  it('sin confirmar: pide el correo de la sesión y avisa', async () => {
    api.requestEmailVerification.mockResolvedValue({ ok: true, status: 202, data: undefined });
    const outcome = await submitResend({
      id: 'u',
      email: 'beto@example.com',
      emailVerified: false,
    });
    expect(outcome.redirect).toEqual({
      status: 303,
      location: '/account?notice=verification-sent',
    });
    expect(api.requestEmailVerification).toHaveBeenCalledWith(
      expect.anything(),
      'beto@example.com',
    );

    api.requestEmailVerification.mockResolvedValue(apiFailure(429, 'RATE_LIMITED'));
    expect(
      (await submitResend({ id: 'u', email: 'beto@example.com', emailVerified: false })).redirect,
    ).toEqual({ status: 303, location: '/account?error=rate-limited' });
  });
});

describe('/verify-email (B7-2, B7-3)', () => {
  const TOKEN = 'A'.repeat(43);
  const load = (url: string, locals: Record<string, unknown> = {}) =>
    run(() => verifyPage.load(formEvent({}, locals, url)) as Promise<unknown>);
  const status = async (promise: Promise<unknown>) => {
    try {
      await promise;
      return undefined;
    } catch (thrown) {
      return (thrown as { status?: number }).status;
    }
  };

  it('B7-2: con un token de 43 caracteres, cookie de su ruta y 303 a /verify-email sin consulta', async () => {
    const outcome = await load(`http://localhost/verify-email?token=${TOKEN}`);
    expect(outcome.redirect).toEqual({ status: 303, location: '/verify-email' });
    expect(cookies.jar.get('cupidilla_email_token')).toEqual({
      value: TOKEN,
      options: expect.objectContaining({ path: '/verify-email', httpOnly: true, sameSite: 'lax' }),
    });
    expect(api.inspectEmailToken).not.toHaveBeenCalled();
  });

  it('B7-2: con ?token=abc no hay cookie y es «Este enlace ya no sirve» (410)', async () => {
    const code = await status(
      verifyPage.load(
        formEvent({}, {}, 'http://localhost/verify-email?token=abc'),
      ) as Promise<unknown>,
    );
    expect(code).toBe(410);
    expect(cookies.jar.has('cupidilla_email_token')).toBe(false);
  });

  it('B7-3: una cookie que la comprobación rechaza da 410 y se borra', async () => {
    cookies = fakeCookies({ cupidilla_email_token: TOKEN });
    api.inspectEmailToken.mockResolvedValue(apiFailure(400, 'TOKEN_INVALID_OR_EXPIRED'));
    const code = await status(
      verifyPage.load(formEvent({}, {}, 'http://localhost/verify-email')) as Promise<unknown>,
    );
    expect(code).toBe(410);
    expect(cookies.jar.has('cupidilla_email_token')).toBe(false);
  });

  it('un enlace válido pide la contraseña si la sesión no es de esa cuenta (K3)', async () => {
    cookies = fakeCookies({ cupidilla_email_token: TOKEN });
    api.inspectEmailToken.mockResolvedValue({
      ok: true,
      status: 200,
      data: { emailHint: 'b•••@example.com', sessionMatches: false },
    });
    const { result } = await load('http://localhost/verify-email', {
      user: { id: 'a', email: 'ana@example.com', emailVerified: true },
      sessionToken: 'S'.repeat(43),
    });
    expect(result).toEqual({
      state: 'form',
      emailHint: 'b•••@example.com',
      needsPassword: true,
      otherSession: true,
    });
    expect(api.inspectEmailToken).toHaveBeenCalledWith(
      expect.anything(),
      { token: TOKEN, purpose: 'verify_email' },
      'S'.repeat(43),
    );
  });

  it('confirmar: opened pone la sesión y borra las dos cookies; los fallos de enlace son pantallas', async () => {
    cookies = fakeCookies({ cupidilla_email_token: TOKEN, cupidilla_pending_email: 'signup:b' });
    api.verifyEmail.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        session: 'opened',
        auth: { user: {}, session: { token: 'NUEVA', expiresAt: '2026-12-11T00:00:00.000Z' } },
      },
    });
    const confirm = (fields: Record<string, string>) =>
      run(() => verifyPage.actions.confirm(formEvent(fields)) as Promise<unknown>);
    expect((await confirm({ withPassword: '1', password: 'x' })).redirect).toEqual({
      status: 303,
      location: '/account?notice=email-verified-signin',
    });
    expect(cookie.set).toHaveBeenCalledWith(expect.anything(), 'NUEVA', expect.any(String));
    expect(cookies.jar.size).toBe(0);

    cookies = fakeCookies({ cupidilla_email_token: TOKEN });
    expect((await confirm({ withPassword: '1', password: '' })).result).toMatchObject({
      status: 400,
      data: { passwordError: 'confirmar.error.contrasena_vacia' },
    });
    api.verifyEmail.mockResolvedValue(apiFailure(403, 'TOKEN_ATTEMPTS_EXCEEDED'));
    expect((await confirm({ withPassword: '1', password: 'x' })).redirect).toEqual({
      status: 303,
      location: '/verify-email?error=attempts-exceeded',
    });
    cookies = fakeCookies({ cupidilla_email_token: TOKEN });
    api.verifyEmail.mockResolvedValue(apiFailure(403, 'PASSWORD_INCORRECT'));
    expect((await confirm({ withPassword: '1', password: 'x' })).result).toMatchObject({
      status: 403,
      data: { passwordError: 'confirmar.error.contrasena' },
    });
    api.verifyEmail.mockResolvedValue(apiFailure(503, 'OUTCOME_UNKNOWN'));
    expect((await confirm({})).result).toMatchObject({
      status: 503,
      data: { general: 'confirmar.error.resultado_incierto' },
    });
  });
});

describe('/account/delete', () => {
  const signedIn = { user: { id: 'u', email: 'ana@example.com' }, sessionToken: 'T'.repeat(43) };
  const submit = (password = 'una frase larga') =>
    run(() => deletePage.actions.password(formEvent({ password }, signedIn)) as Promise<unknown>);

  it('contraseña vacía: error de campo y no llama a la API', async () => {
    const { result } = await submit('');
    expect(result).toMatchObject({
      status: 400,
      data: { errors: { fields: { password: 'eliminar.error.contrasena_vacia' } } },
    });
    expect(api.deleteAccount).not.toHaveBeenCalled();
  });

  it('contraseña incorrecta: error en el campo y la cookie se conserva', async () => {
    api.deleteAccount.mockResolvedValue(apiFailure(403, 'PASSWORD_INCORRECT'));
    const { result } = await submit();
    expect(result).toMatchObject({
      status: 403,
      data: { errors: { fields: { password: 'eliminar.error.contrasena' } } },
    });
    expect(cookie.clear).not.toHaveBeenCalled();
  });

  it('429 → comun.error.limite; API caída → eliminar.error.servidor («tu cuenta sigue como estaba»)', async () => {
    api.deleteAccount.mockResolvedValue(apiFailure(429, 'RATE_LIMITED'));
    expect((await submit()).result).toMatchObject({
      data: { errors: { general: 'comun.error.limite' } },
    });
    api.deleteAccount.mockResolvedValue(apiFailure(503, 'API_UNAVAILABLE'));
    expect((await submit()).result).toMatchObject({
      data: { errors: { general: 'eliminar.error.servidor' } },
    });
    expect(cookie.clear).not.toHaveBeenCalled();
  });

  it('resultado incierto → 503 con eliminar.error.resultado_incierto; la cookie se conserva (criterios 62 y 63)', async () => {
    api.deleteAccount.mockResolvedValue(apiFailure(503, 'OUTCOME_UNKNOWN'));
    const { result, redirect } = await submit();
    expect(redirect).toBeUndefined();
    expect(result).toMatchObject({
      status: 503,
      data: { errors: { fields: {}, general: 'eliminar.error.resultado_incierto' } },
    });
    expect(api.deleteAccount).toHaveBeenCalledOnce();
    expect(cookie.clear).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/una frase larga|OUTCOME_UNKNOWN/);
  });

  it('sesión caducada (401): como sin sesión, a /login?next=/account', async () => {
    api.deleteAccount.mockResolvedValue(apiFailure(401, 'UNAUTHENTICATED'));
    expect((await submit()).redirect).toEqual({
      status: 303,
      location: '/login?next=/account',
    });
  });

  it('éxito: borra la cookie y vuelve a la portada con el aviso', async () => {
    api.deleteAccount.mockResolvedValue({ ok: true, status: 204, data: undefined });
    expect((await submit()).redirect).toEqual({
      status: 303,
      location: '/?notice=account-deleted',
    });
    expect(cookie.clear).toHaveBeenCalledOnce();
  });
});
