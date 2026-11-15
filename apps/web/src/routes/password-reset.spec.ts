import { latestAdultBirthDate, referenceToday, SERVICE_TERMS_VERSION } from '@cupidilla/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// La puerta a la API y la cookie de sesión se sustituyen: aquí se prueba qué hace cada acción con
// cada respuesta (correo, fase C).
const api = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
  inspectEmailToken: vi.fn(),
  resetPassword: vi.fn(),
  completeDataReview: vi.fn(),
  logout: vi.fn(),
}));
const cookie = vi.hoisted(() => ({ set: vi.fn(), clear: vi.fn() }));

vi.mock('#lib/server/api-client.ts', () => ({ api }));
vi.mock('#lib/server/min-age.ts', () => ({
  currentMinAge: () => Promise.resolve(18),
  displayMailConfig: () =>
    Promise.resolve({ unverifiedReminder: true, passwordChangedNotice: true }),
}));
vi.mock('#lib/server/session-cookie.ts', () => ({
  setSessionCookie: cookie.set,
  clearSessionCookie: cookie.clear,
  getSessionToken: vi.fn(),
}));

const forgotPage = await import('./forgot-password/+page.server.ts');
const forgotCheckPage = await import('./forgot-password/check-email/+page.server.ts');
const resetPage = await import('./reset-password/+page.server.ts');
const reviewPage = await import('./(private)/account/review/+page.server.ts');

const TOKEN = 'A'.repeat(43);
const SESSION = 'S'.repeat(43);

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
    setHeaders: vi.fn(),
    getClientAddress: () => '127.0.0.1',
  } as unknown as E;
}

const apiFailure = (status: number, code: string, fields?: unknown) => ({
  ok: false,
  status,
  error: { code, fields },
});

async function run(
  action: () => Promise<unknown>,
): Promise<{ result?: unknown; redirect?: unknown; status?: number }> {
  try {
    return { result: await action() };
  } catch (thrown) {
    if (typeof thrown === 'object' && thrown !== null && 'location' in thrown) {
      const { status, location } = thrown as { status: number; location: string };
      return { redirect: { status, location } };
    }
    if (typeof thrown === 'object' && thrown !== null && 'status' in thrown) {
      return { status: (thrown as { status: number }).status };
    }
    throw thrown;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  cookies = fakeCookies();
});

describe('/forgot-password (C4-2)', () => {
  const submit = (email: string) =>
    run(() => forgotPage.actions.default(formEvent({ email })) as Promise<unknown>);

  it.each(['ana@example.com', 'nadie@example.com'])(
    'C4-2: con %s y 202, 303 a /forgot-password/check-email con la cookie reset:',
    async (email) => {
      api.requestPasswordReset.mockResolvedValue({ ok: true, status: 202, data: undefined });
      expect((await submit(` ${email.toUpperCase()} `)).redirect).toEqual({
        status: 303,
        location: '/forgot-password/check-email',
      });
      expect(api.requestPasswordReset).toHaveBeenCalledWith(expect.anything(), email);
      expect(cookies.jar.get('cupidilla_pending_email')).toEqual({
        value: `reset:${email}`,
        options: expect.objectContaining({ path: '/', httpOnly: true, sameSite: 'lax' }),
      });
    },
  );

  it('correo vacío o mal formado: error de campo con el valor conservado, sin llamar a la API', async () => {
    expect((await submit('')).result).toMatchObject({
      status: 400,
      data: { email: '', errors: { email: 'registro.error.correo_vacio' } },
    });
    expect((await submit('ana@')).result).toMatchObject({
      data: { email: 'ana@', errors: { email: 'registro.error.correo_formato' } },
    });
    expect(api.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('429 → comun.error.limite; API caída → olvido.error.servidor; sin cookie', async () => {
    api.requestPasswordReset.mockResolvedValue(apiFailure(429, 'RATE_LIMITED'));
    expect((await submit('ana@example.com')).result).toMatchObject({
      status: 429,
      data: { email: 'ana@example.com', errors: { general: 'comun.error.limite' } },
    });
    api.requestPasswordReset.mockResolvedValue(apiFailure(503, 'API_UNAVAILABLE'));
    expect((await submit('ana@example.com')).result).toMatchObject({
      data: { errors: { general: 'olvido.error.servidor' } },
    });
    expect(cookies.jar.has('cupidilla_pending_email')).toBe(false);
  });
});

describe('/forgot-password/check-email', () => {
  it('sin la cookie reset: vuelve a /forgot-password; con ella, el correo y «1 hora»', async () => {
    const load = () =>
      run(
        () =>
          forgotCheckPage.load(
            formEvent({}, {}, 'http://localhost/forgot-password/check-email'),
          ) as Promise<unknown>,
      );
    expect((await load()).redirect).toEqual({ status: 303, location: '/forgot-password' });
    cookies = fakeCookies({ cupidilla_pending_email: 'signup:ana@example.com' });
    expect((await load()).redirect).toEqual({ status: 303, location: '/forgot-password' });
    cookies = fakeCookies({ cupidilla_pending_email: 'reset:ana@example.com' });
    expect((await load()).result).toEqual({
      email: 'ana@example.com',
      duration: '1 hora',
      message: null,
    });
  });

  it('reenviar pide otra vez la recuperación con el correo de la cookie', async () => {
    cookies = fakeCookies({ cupidilla_pending_email: 'reset:ana@example.com' });
    api.requestPasswordReset.mockResolvedValue({ ok: true, status: 202, data: undefined });
    const resend = () =>
      run(() => forgotCheckPage.actions.resend(formEvent({})) as Promise<unknown>);
    expect((await resend()).redirect).toEqual({
      status: 303,
      location: '/forgot-password/check-email?notice=resent',
    });
    expect(api.requestPasswordReset).toHaveBeenCalledWith(expect.anything(), 'ana@example.com');
    api.requestPasswordReset.mockResolvedValue(apiFailure(429, 'RATE_LIMITED'));
    expect((await resend()).redirect).toEqual({
      status: 303,
      location: '/forgot-password/check-email?error=rate-limited',
    });
  });
});

describe('/reset-password (C4-1, C4-4)', () => {
  const load = (url: string, locals: Record<string, unknown> = {}) =>
    run(() => resetPage.load(formEvent({}, locals, url)) as Promise<unknown>);
  const submit = (password = 'otra frase larga nueva') =>
    run(() => resetPage.actions.default(formEvent({ password })) as Promise<unknown>);
  const resetOk = (dataReviewRequired: boolean) => ({
    ok: true,
    status: 200,
    data: {
      user: {
        id: '6f1d2c3b-4a5e-4f60-8b7c-9d0e1f2a3b4c',
        email: 'beto@example.com',
        createdAt: '2026-11-11T10:00:00.000Z',
        emailVerified: true,
        dataReviewRequired,
      },
      session: { token: SESSION, expiresAt: '2026-12-11T10:00:00.000Z' },
    },
  });

  it('C4-1: con un token de 43 caracteres, cookie en Path=/reset-password y 303 sin consulta', async () => {
    const outcome = await load(`http://localhost/reset-password?token=${TOKEN}`);
    expect(outcome.redirect).toEqual({ status: 303, location: '/reset-password' });
    expect(cookies.jar.get('cupidilla_email_token')).toEqual({
      value: TOKEN,
      options: expect.objectContaining({ path: '/reset-password', httpOnly: true }),
    });
    expect(api.inspectEmailToken).not.toHaveBeenCalled();
  });

  it('?token=abc o un enlace que la comprobación rechaza → 410 y sin cookie', async () => {
    expect((await load('http://localhost/reset-password?token=abc')).status).toBe(410);
    cookies = fakeCookies({ cupidilla_email_token: TOKEN });
    api.inspectEmailToken.mockResolvedValue(apiFailure(400, 'TOKEN_INVALID_OR_EXPIRED'));
    expect((await load('http://localhost/reset-password')).status).toBe(410);
    expect(cookies.jar.has('cupidilla_email_token')).toBe(false);
  });

  it('un enlace válido da la pista y avisa si hay una sesión abierta', async () => {
    cookies = fakeCookies({ cupidilla_email_token: TOKEN });
    api.inspectEmailToken.mockResolvedValue({
      ok: true,
      status: 200,
      data: { emailHint: 'a•••@example.com', sessionMatches: false },
    });
    expect((await load('http://localhost/reset-password')).result).toEqual({
      state: 'form',
      emailHint: 'a•••@example.com',
      signedIn: false,
    });
    expect(api.inspectEmailToken).toHaveBeenCalledWith(expect.anything(), {
      token: TOKEN,
      purpose: 'reset_password',
    });
    const withSession = await load('http://localhost/reset-password', {
      user: { id: 'm', email: 'marta@example.com', emailVerified: true },
      sessionToken: SESSION,
    });
    expect(withSession.result).toMatchObject({ signedIn: true });
  });

  it('sin JS, el load posterior a una acción con el token ya inservible conserva el formulario (no «enlace no válido»)', async () => {
    cookies = fakeCookies({ cupidilla_email_token: TOKEN });
    api.inspectEmailToken.mockResolvedValue(apiFailure(400, 'TOKEN_INVALID_OR_EXPIRED'));
    const event = formEvent({}, {}, 'http://localhost/reset-password');
    (event as unknown as { request: { method: string } }).request.method = 'POST';
    const outcome = await run(() => resetPage.load(event as never) as Promise<unknown>);
    expect(outcome.result).toEqual({ state: 'form', emailHint: null, signedIn: false });
    expect(cookies.jar.has('cupidilla_email_token')).toBe(true);
  });

  it.each([
    [true, '/account/review?notice=password-reset'],
    [false, '/account?notice=password-reset'],
  ])(
    'C4-4: dataReviewRequired %s → %s, con la sesión nueva y sin las dos cookies',
    async (review, location) => {
      cookies = fakeCookies({
        cupidilla_email_token: TOKEN,
        cupidilla_pending_email: 'reset:beto@example.com',
      });
      api.resetPassword.mockResolvedValue(resetOk(review));
      expect((await submit()).redirect).toEqual({ status: 303, location });
      expect(cookie.set).toHaveBeenCalledWith(cookies, SESSION, '2026-12-11T10:00:00.000Z');
      expect(cookies.jar.has('cupidilla_email_token')).toBe(false);
      expect(cookies.jar.has('cupidilla_pending_email')).toBe(false);
    },
  );

  it('contraseña de 9 caracteres: error de campo y no llama a la API; el token se conserva', async () => {
    cookies = fakeCookies({ cupidilla_email_token: TOKEN });
    expect((await submit('a'.repeat(9))).result).toMatchObject({
      status: 400,
      data: { passwordError: 'registro.error.contrasena_corta' },
    });
    expect(api.resetPassword).not.toHaveBeenCalled();
    expect(cookies.jar.has('cupidilla_email_token')).toBe(true);
  });

  it('enlace rechazado al guardar → 303 ?error=token-invalid y sin cookie del token', async () => {
    cookies = fakeCookies({ cupidilla_email_token: TOKEN });
    api.resetPassword.mockResolvedValue(apiFailure(400, 'TOKEN_INVALID_OR_EXPIRED'));
    expect((await submit()).redirect).toEqual({
      status: 303,
      location: '/reset-password?error=token-invalid',
    });
    expect(cookies.jar.has('cupidilla_email_token')).toBe(false);
    cookies = fakeCookies();
    expect((await submit()).redirect).toEqual({
      status: 303,
      location: '/reset-password?error=token-invalid',
    });
  });

  it('C4-6: resultado incierto → restablecer.error.resultado_incierto; 5xx → servidor; el token sigue', async () => {
    cookies = fakeCookies({ cupidilla_email_token: TOKEN });
    api.resetPassword.mockResolvedValue(apiFailure(503, 'OUTCOME_UNKNOWN'));
    expect((await submit()).result).toMatchObject({
      status: 503,
      data: { general: 'restablecer.error.resultado_incierto' },
    });
    api.resetPassword.mockResolvedValue(apiFailure(503, 'API_UNAVAILABLE'));
    expect((await submit()).result).toMatchObject({
      data: { general: 'restablecer.error.servidor' },
    });
    expect(cookie.set).not.toHaveBeenCalled();
    expect(cookies.jar.has('cupidilla_email_token')).toBe(true);
  });
});

describe('/account/review (C3-1b, C4-5)', () => {
  const pending = {
    user: { id: 'b', email: 'beto@example.com', emailVerified: true, dataReviewRequired: true },
    sessionToken: SESSION,
  };
  const form = {
    day: '5',
    month: '5',
    year: '1990',
    acceptTerms: 'on',
    termsVersion: SERVICE_TERMS_VERSION,
  };
  const submit = (fields: Record<string, string> = form, locals = pending) =>
    run(() => reviewPage.actions.review(formEvent(fields, locals)) as Promise<unknown>);

  /** Fecha del menor más mayor: cumple 18 mañana. */
  function minorParts(): Record<string, string> {
    const latest = latestAdultBirthDate(referenceToday(new Date()), 18);
    const [year, month, day] = latest.split('-').map(Number) as [number, number, number];
    const minor = new Date(Date.UTC(year, month - 1, day + 1));
    return {
      day: String(minor.getUTCDate()),
      month: String(minor.getUTCMonth() + 1),
      year: String(minor.getUTCFullYear()),
    };
  }

  it('C3-1b: la carga no llama a la API ni devuelve ninguna fecha', async () => {
    const { result } = await run(
      () =>
        reviewPage.load(
          formEvent({}, pending, 'http://localhost/account/review?notice=password-reset'),
        ) as Promise<unknown>,
    );
    expect(result).toEqual({
      message: {
        kind: 'success',
        text: 'Hemos guardado tu contraseña nueva y confirmado tu correo. Por seguridad, hemos cerrado las demás sesiones de tu cuenta: tendrás que volver a entrar en ellas. También te hemos enviado un correo para avisarte del cambio.',
      },
    });
    expect(JSON.stringify(result)).not.toContain('1990');
    for (const call of Object.values(api)) expect(call).not.toHaveBeenCalled();
  });

  it('sin revisión pendiente, la carga y el envío van a /account', async () => {
    const verified = { ...pending, user: { ...pending.user, dataReviewRequired: false } };
    const loaded = await run(
      () => reviewPage.load(formEvent({}, verified, 'http://localhost/account/review')) as never,
    );
    expect(loaded.redirect).toEqual({ status: 303, location: '/account' });
    expect((await submit(form, verified)).redirect).toEqual({ status: 303, location: '/account' });
    expect(api.completeDataReview).not.toHaveBeenCalled();
  });

  it('204 → /account?notice=details-reviewed', async () => {
    api.completeDataReview.mockResolvedValue({ ok: true, status: 204, data: undefined });
    expect((await submit()).redirect).toEqual({
      status: 303,
      location: '/account?notice=details-reviewed',
    });
    expect(api.completeDataReview).toHaveBeenCalledWith(expect.anything(), SESSION, {
      birthDate: '1990-05-05',
      acceptTerms: true,
      termsVersion: SERVICE_TERMS_VERSION,
    });
  });

  it('C4-5: con una fecha de menor (aunque falte la casilla) llama a la API, borra la cookie y pinta el cierre sin valores', async () => {
    api.completeDataReview.mockResolvedValue(apiFailure(422, 'UNDERAGE'));
    const { result } = await submit({ ...minorParts(), acceptTerms: '', termsVersion: '' });
    expect(api.completeDataReview).toHaveBeenCalledOnce();
    // La casilla viaja tal como está: la API decide que es menor y borra la cuenta.
    expect(api.completeDataReview.mock.calls[0]?.[2]).not.toHaveProperty('acceptTerms');
    expect(cookie.clear).toHaveBeenCalledOnce();
    expect(result).toEqual({ status: 422, data: { underage: true } });
  });

  it('un menor con la API caída: error general sin ningún valor y la sesión sigue', async () => {
    api.completeDataReview.mockResolvedValue(apiFailure(503, 'API_UNAVAILABLE'));
    const { result } = await submit({ ...form, ...minorParts() });
    expect(result).toEqual({
      status: 503,
      data: {
        values: undefined,
        errors: { fields: {}, dateParts: [], general: 'revision.error.servidor' },
      },
    });
    expect(cookie.clear).not.toHaveBeenCalled();
  });

  it('adulto sin la casilla: la API responde acceptTerms required y vuelve el error con los valores', async () => {
    api.completeDataReview.mockResolvedValue(
      apiFailure(400, 'VALIDATION_FAILED', [{ path: 'acceptTerms', issue: 'required' }]),
    );
    const { result } = await submit({ ...form, acceptTerms: '' });
    expect(api.completeDataReview.mock.calls[0]?.[2]).toEqual({
      birthDate: '1990-05-05',
      termsVersion: SERVICE_TERMS_VERSION,
    });
    expect(result).toMatchObject({
      status: 400,
      data: {
        values: { day: '5', month: '5', year: '1990', acceptTerms: false },
        errors: { fields: { acceptTerms: 'registro.error.condiciones' } },
      },
    });
    expect(cookie.clear).not.toHaveBeenCalled();
  });

  it('un 400 de forma que no sea acceptTerms no prueba que la API vio a un adulto: sin valores si la fecha parece de menor', async () => {
    api.completeDataReview.mockResolvedValue(
      apiFailure(400, 'VALIDATION_FAILED', [{ path: 'termsVersion', issue: 'required' }]),
    );
    const { result } = await submit({ ...form, ...minorParts() });
    expect(result).toMatchObject({ status: 400, data: { values: undefined } });
  });

  it('QA: MIN_AGE distinto en la web (18 en caché) y en la API: la API decide menor y la web pinta el cierre', async () => {
    api.completeDataReview.mockResolvedValue(apiFailure(422, 'UNDERAGE'));
    // 20 años: adulto para la caché de la web, menor para una API con MIN_AGE 21.
    const year = String(new Date().getUTCFullYear() - 20);
    const { result } = await submit({ ...form, year, acceptTerms: '' });
    expect(api.completeDataReview.mock.calls[0]?.[2]).not.toHaveProperty('acceptTerms');
    expect(result).toEqual({ status: 422, data: { underage: true } });
    expect(cookie.clear).toHaveBeenCalledOnce();
  });

  it('errores de forma: no llama a la API y conserva día, mes, año y casilla', async () => {
    const { result } = await submit({ ...form, day: '31', month: '2', acceptTerms: '' });
    expect(result).toMatchObject({
      status: 400,
      data: {
        values: { day: '31', month: '2', year: '1990', acceptTerms: false },
        errors: {
          fields: {
            birthDate: 'registro.error.fecha_inexistente',
            acceptTerms: 'registro.error.condiciones',
          },
        },
      },
    });
    expect(api.completeDataReview).not.toHaveBeenCalled();
  });

  it('409 → condiciones_version con la casilla desmarcada; OUTCOME_UNKNOWN → resultado incierto', async () => {
    api.completeDataReview.mockResolvedValue(apiFailure(409, 'TERMS_VERSION_OUTDATED'));
    expect((await submit()).result).toMatchObject({
      status: 409,
      data: {
        values: { acceptTerms: false },
        errors: { fields: { acceptTerms: 'registro.error.condiciones_version' } },
      },
    });
    api.completeDataReview.mockResolvedValue(apiFailure(503, 'OUTCOME_UNKNOWN'));
    expect((await submit()).result).toMatchObject({
      data: { errors: { general: 'revision.error.resultado_incierto' } },
    });
  });

  it('cerrar sesión: borra la cookie y vuelve a la portada', async () => {
    api.logout.mockResolvedValue({ ok: true, status: 204, data: undefined });
    expect(
      (await run(() => reviewPage.actions.logout(formEvent({}, pending)) as Promise<unknown>))
        .redirect,
    ).toEqual({ status: 303, location: '/?notice=signed-out' });
    expect(cookie.clear).toHaveBeenCalledOnce();
  });
});
