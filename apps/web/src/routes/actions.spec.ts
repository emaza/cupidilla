import { latestAdultBirthDate, referenceToday } from '@cupidilla/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// La puerta a la API y la cookie se sustituyen: aquí se prueba qué hace cada acción con cada respuesta.
const api = vi.hoisted(() => ({
  register: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  deleteAccount: vi.fn(),
  session: vi.fn(),
  account: vi.fn(),
}));
const cookie = vi.hoisted(() => ({ set: vi.fn(), clear: vi.fn() }));

vi.mock('#lib/server/api-client.ts', () => ({ api }));
vi.mock('#lib/server/session-cookie.ts', () => ({
  setSessionCookie: cookie.set,
  clearSessionCookie: cookie.clear,
  getSessionToken: vi.fn(),
}));

const registro = await import('./(invitado)/registro/+page.server.ts');
const entrar = await import('./(invitado)/entrar/+page.server.ts');
const cuenta = await import('./(privado)/cuenta/+page.server.ts');
const eliminar = await import('./(privado)/cuenta/eliminar/+page.server.ts');

const TERMS = '2026-11-borrador';

/** Evento de SvelteKit mínimo con un formulario. `E` lo fija el tipo que espera cada acción. */
function formEvent<E>(fields: Record<string, string>, locals: Record<string, unknown> = {}): E {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return {
    request: { formData: () => Promise.resolve(data) },
    cookies: {},
    locals: { user: null, sessionToken: null, ...locals },
    url: new URL('http://localhost/'),
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
  correo: 'ana@example.com',
  contrasena: 'una frase larga de prueba',
  dia: '5',
  mes: '5',
  anio: '1990',
  condiciones: 'on',
  version_condiciones: TERMS,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('registro: respuestas de la API (criterios 31 y 32)', () => {
  const submit = (fields: Record<string, string> = adultForm) =>
    run(() => registro.actions.default(formEvent(fields)) as Promise<unknown>);

  it('429 → comun.error.limite, con los valores conservados y sin la contraseña', async () => {
    api.register.mockResolvedValue(apiFailure(429, 'RATE_LIMITED'));
    const { result } = await submit();
    expect(result).toMatchObject({
      status: 429,
      data: {
        errors: { fields: {}, general: 'comun.error.limite' },
        values: { correo: 'ana@example.com', dia: '5', mes: '5', anio: '1990', condiciones: true },
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
        values: { correo: 'ana@example.com', condiciones: true },
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
        values: { correo: 'ana@example.com', dia: '5', mes: '5', anio: '1990', condiciones: true },
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

  it('con la API acierta: cookie y redirección 303 a /cuenta, sin devolver el token', async () => {
    api.register.mockResolvedValue({
      ok: true,
      status: 201,
      data: {
        user: {},
        session: { token: 'TOKEN-SECRETO', expiresAt: '2026-12-11T00:00:00.000Z' },
      },
    });
    const outcome = await submit();
    expect(outcome.redirect).toEqual({ status: 303, location: '/cuenta' });
    expect(cookie.set).toHaveBeenCalledWith(expect.anything(), 'TOKEN-SECRETO', expect.any(String));
  });

  it('un menor: pantalla de cierre sin ningún valor y sin llamar a la API', async () => {
    const latest = latestAdultBirthDate(referenceToday(new Date()));
    const [year, month, day] = latest.split('-').map(Number) as [number, number, number];
    const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
    const { result } = await submit({
      ...adultForm,
      dia: String(tomorrow.getUTCDate()),
      mes: String(tomorrow.getUTCMonth() + 1),
      anio: String(tomorrow.getUTCFullYear()),
      contrasena: 'x',
      condiciones: '',
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
        values: { condiciones: false, correo: 'ana@example.com' },
        errors: { fields: { condiciones: 'registro.error.condiciones_version' } },
      },
    });
  });

  it('una versión de condiciones manipulada en el formulario llega a la API tal cual (ella decide)', async () => {
    api.register.mockResolvedValue(apiFailure(409, 'TERMS_VERSION_OUTDATED'));
    await submit({ ...adultForm, version_condiciones: 'inventada' });
    expect(api.register).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ termsVersion: 'inventada', acceptTerms: true }),
    );
  });

  it('sin casilla marcada no se llama a la API', async () => {
    const { result } = await submit({ ...adultForm, condiciones: '' });
    expect(result).toMatchObject({
      status: 400,
      data: { errors: { fields: { condiciones: 'registro.error.condiciones' } } },
    });
    expect(api.register).not.toHaveBeenCalled();
  });
});

describe('entrar: respuestas de la API (criterios 31, 32, 8 y 10)', () => {
  const submit = (fields: Record<string, string> = {}) =>
    run(
      () =>
        entrar.actions.default(
          formEvent({ correo: 'ana@example.com', contrasena: 'una frase larga', ...fields }),
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
      data: { errors: { general: 'comun.error.limite' }, values: { correo: 'ana@example.com' } },
    });
  });

  it('API caída → entrar.error.servidor', async () => {
    api.login.mockResolvedValue(apiFailure(503, 'API_UNAVAILABLE'));
    expect((await submit()).result).toMatchObject({
      status: 503,
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
    const { result } = await submit({ correo: 'no es un correo' });
    expect(result).toMatchObject({ data: { errors: { general: 'entrar.error.credenciales' } } });
    expect(api.login).not.toHaveBeenCalled();
  });

  it.each([
    ['/cuenta/eliminar', '/cuenta/eliminar'],
    ['/cuenta', '/cuenta'],
    ['https://otro.sitio', '/cuenta'],
    ['//otro.sitio', '/cuenta'],
    ['/\\otro.sitio', '/cuenta'],
    ['javascript:alert(1)', '/cuenta'],
    ['', '/cuenta'],
  ])('siguiente=%j → redirige a %s', async (siguiente, expected) => {
    api.login.mockResolvedValue(ok);
    const outcome = await submit({ siguiente });
    expect(outcome.redirect).toEqual({ status: 303, location: expected });
  });
});

describe('/cuenta: salir (acuerdo A14)', () => {
  const signedIn = { user: { id: 'u', email: 'ana@example.com' }, sessionToken: 'T'.repeat(43) };
  const salir = () => run(() => cuenta.actions.salir(formEvent({}, signedIn)) as Promise<unknown>);

  it('204: borra la cookie y vuelve a la portada con el aviso', async () => {
    api.logout.mockResolvedValue({ ok: true, status: 204, data: undefined });
    expect((await salir()).redirect).toEqual({ status: 303, location: '/?aviso=sesion-cerrada' });
    expect(cookie.clear).toHaveBeenCalledOnce();
  });

  it('401 (la sesión ya no existe): también sale', async () => {
    api.logout.mockResolvedValue(apiFailure(401, 'UNAUTHENTICATED'));
    expect((await salir()).redirect).toEqual({ status: 303, location: '/?aviso=sesion-cerrada' });
    expect(cookie.clear).toHaveBeenCalledOnce();
  });

  it.each([
    ['la API no responde', apiFailure(503, 'API_UNAVAILABLE')],
    ['la API da 500', apiFailure(500, 'INTERNAL_ERROR')],
  ])('%s: NO borra la cookie y muestra cuenta.error.servidor', async (_, failure) => {
    api.logout.mockResolvedValue(failure);
    const { result, redirect } = await salir();
    expect(redirect).toBeUndefined();
    expect(result).toMatchObject({ status: 503, data: { general: 'cuenta.error.servidor' } });
    expect(cookie.clear).not.toHaveBeenCalled();
  });
});

describe('/cuenta/eliminar', () => {
  const signedIn = { user: { id: 'u', email: 'ana@example.com' }, sessionToken: 'T'.repeat(43) };
  const submit = (password = 'una frase larga') =>
    run(
      () =>
        eliminar.actions.default(formEvent({ contrasena: password }, signedIn)) as Promise<unknown>,
    );

  it('contraseña vacía: error de campo y no llama a la API', async () => {
    const { result } = await submit('');
    expect(result).toMatchObject({
      status: 400,
      data: { errors: { fields: { contrasena: 'eliminar.error.contrasena_vacia' } } },
    });
    expect(api.deleteAccount).not.toHaveBeenCalled();
  });

  it('contraseña incorrecta: error en el campo y la cookie se conserva', async () => {
    api.deleteAccount.mockResolvedValue(apiFailure(403, 'PASSWORD_INCORRECT'));
    const { result } = await submit();
    expect(result).toMatchObject({
      status: 403,
      data: { errors: { fields: { contrasena: 'eliminar.error.contrasena' } } },
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

  it('sesión caducada (401): como sin sesión, a /entrar?siguiente=/cuenta', async () => {
    api.deleteAccount.mockResolvedValue(apiFailure(401, 'UNAUTHENTICATED'));
    expect((await submit()).redirect).toEqual({
      status: 303,
      location: '/entrar?siguiente=/cuenta',
    });
  });

  it('éxito: borra la cookie y vuelve a la portada con el aviso', async () => {
    api.deleteAccount.mockResolvedValue({ ok: true, status: 204, data: undefined });
    expect((await submit()).redirect).toEqual({
      status: 303,
      location: '/?aviso=cuenta-eliminada',
    });
    expect(cookie.clear).toHaveBeenCalledOnce();
  });
});
