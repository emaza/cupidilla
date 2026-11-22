import { CAPTCHA_PAYLOAD_MAX, PRIVACY_POLICY_VERSION } from '@cupidilla/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// La puerta a la API y la configuración se sustituyen: aquí se prueba qué hacen las acciones con
// la comprobación antibots (técnico de captcha §6, T7–T9).
const api = vi.hoisted(() => ({
  captchaChallenge: vi.fn(),
  sendContactMessage: vi.fn(),
  requestPasswordReset: vi.fn(),
  requestEmailVerification: vi.fn(),
}));
vi.mock('#lib/server/api-client.ts', () => ({ api }));
vi.mock('#lib/server/min-age.ts', () => ({
  displayContactConfig: () => Promise.resolve({ ackEmail: false }),
}));

const challengeRoute = await import('./captcha/challenge/+server.ts');
const contactPage = await import('./contact/+page.server.ts');
const forgotPage = await import('./forgot-password/+page.server.ts');
const signupCheckPage = await import('./(guest)/register/check-email/+page.server.ts');
const { captchaFromForm } = await import('#lib/forms/form-data.ts');
const { captchaErrorText, captchaFailure } = await import('#lib/forms/captcha.ts');

const CHALLENGE = {
  parameters: {
    algorithm: 'PBKDF2/SHA-256',
    cost: 1,
    expiresAt: 1795400000,
    keyLength: 32,
    keyPrefix: '7a2b',
    keySignature: '3676',
    nonce: 'ffb9',
    salt: '5b13',
  },
  signature: 'ef34',
};

function fakeCookies(initial: Record<string, string> = {}) {
  const jar = new Map(Object.entries(initial));
  return {
    get: (name: string) => jar.get(name),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  };
}

function formEvent<E>(fields: Record<string, string>, cookies = fakeCookies()): E {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return {
    request: { formData: () => Promise.resolve(data) },
    cookies,
    locals: { user: null, sessionToken: null },
    getClientAddress: () => '127.0.0.1',
  } as unknown as E;
}

async function run(action: () => unknown): Promise<{ result?: unknown; redirect?: unknown }> {
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

const failure = (status: number, code: string) => ({ ok: false, status, error: { code } });
const accepted = { ok: true, status: 202, data: undefined };

const contactForm = {
  name: 'Lucía Pérez',
  email: 'lucia@example.com',
  subject: 'Duda sobre mi cuenta',
  message: 'Hola, no me llega el correo.',
  acceptPrivacy: 'on',
  privacyVersion: PRIVACY_POLICY_VERSION,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /captcha/challenge (técnico de captcha §6.4)', () => {
  type ChallengeEvent = Parameters<typeof challengeRoute.GET>[0];
  const get = () => challengeRoute.GET({} as ChallengeEvent);

  it('devuelve el reto de la API con no-store', async () => {
    api.captchaChallenge.mockResolvedValue({ ok: true, status: 200, data: CHALLENGE });
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(CHALLENGE);
  });

  it('con la comprobación desactivada en la API, 404', async () => {
    api.captchaChallenge.mockResolvedValue(failure(404, 'NOT_FOUND'));
    expect((await get()).status).toBe(404);
  });

  it.each([
    ['la API caída', failure(503, 'API_UNAVAILABLE')],
    ['un reto con campos de más (fuera del esquema)', failure(502, 'API_UNAVAILABLE')],
    ['el límite de la API', failure(429, 'RATE_LIMITED')],
  ])('con %s, 503 con no-store', async (_name, result) => {
    api.captchaChallenge.mockResolvedValue(result);
    const response = await get();
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('captchaFromForm y los textos de error', () => {
  const form = (value: string) => {
    const data = new FormData();
    data.set('captcha', value);
    return data;
  };

  it('vacío o de más de 4096 caracteres: undefined; si no, recortado', () => {
    expect(captchaFromForm(new FormData())).toBeUndefined();
    expect(captchaFromForm(form('   '))).toBeUndefined();
    expect(captchaFromForm(form('A'.repeat(CAPTCHA_PAYLOAD_MAX + 1)))).toBeUndefined();
    expect(captchaFromForm(form(' abc= '))).toBe('abc=');
  });

  it('dos CAPTCHA_INVALID seguidos pasan a invalido_repetido; CAPTCHA_REQUIRED no cuenta', () => {
    const data = new FormData();
    expect(captchaFailure('CAPTCHA_INVALID', data)).toEqual({
      key: 'captcha.error.invalido',
      failures: 1,
    });
    data.set('captchaFailures', '1');
    expect(captchaFailure('CAPTCHA_INVALID', data).key).toBe('captcha.error.invalido_repetido');
    expect(captchaFailure('CAPTCHA_REQUIRED', data)).toEqual({
      key: 'captcha.error.requerido',
      failures: 1,
    });
  });

  it('la frase de soporte solo con la dirección conocida y en requerido e invalido_repetido', () => {
    const support = 'soporte@cupidilla.es';
    expect(captchaErrorText('captcha.error.invalido_repetido', support)).toContain(support);
    expect(captchaErrorText('captcha.error.requerido', support)).toContain(support);
    expect(captchaErrorText('captcha.error.invalido', support)).not.toContain(support);
    expect(captchaErrorText('captcha.error.requerido', null)).not.toContain('escríbenos');
  });
});

describe('/contact con la comprobación', () => {
  type ContactEvent = Parameters<typeof contactPage.actions.default>[0];

  it('pasa la solución del formulario a la API', async () => {
    api.sendContactMessage.mockResolvedValue(accepted);
    await run(() =>
      contactPage.actions.default(formEvent<ContactEvent>({ ...contactForm, captcha: 'abc=' })),
    );
    expect(api.sendContactMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: 'lucia@example.com' }),
      'abc=',
    );
  });

  it.each([
    ['CAPTCHA_REQUIRED', 'captcha.error.requerido'],
    ['CAPTCHA_INVALID', 'captcha.error.invalido'],
  ])('%s: 400 con el error en el campo captcha y todo lo escrito', async (code, key) => {
    api.sendContactMessage.mockResolvedValue(failure(400, code));
    const { result } = await run(() =>
      contactPage.actions.default(formEvent<ContactEvent>(contactForm)),
    );
    expect(result).toMatchObject({
      status: 400,
      data: {
        values: { name: 'Lucía Pérez', subject: 'Duda sobre mi cuenta', acceptPrivacy: true },
        errors: { fields: { captcha: key } },
      },
    });
  });
});

describe('/forgot-password con la comprobación', () => {
  type ForgotEvent = Parameters<typeof forgotPage.actions.default>[0];

  it('pasa la solución y, con CAPTCHA_INVALID repetido, invalido_repetido con el correo', async () => {
    api.requestPasswordReset.mockResolvedValue(failure(400, 'CAPTCHA_INVALID'));
    const { result } = await run(() =>
      forgotPage.actions.default(
        formEvent<ForgotEvent>({ email: 'ana@example.com', captcha: 'abc=', captchaFailures: '1' }),
      ),
    );
    expect(api.requestPasswordReset).toHaveBeenCalledWith(
      expect.anything(),
      'ana@example.com',
      'abc=',
    );
    expect(result).toMatchObject({
      status: 400,
      data: {
        email: 'ana@example.com',
        errors: { captcha: 'captcha.error.invalido_repetido' },
        captchaFailures: 2,
      },
    });
  });

  it('con un correo no válido no llama a la API (la comprobación no se gasta)', async () => {
    await run(() => forgotPage.actions.default(formEvent<ForgotEvent>({ email: 'no-es' })));
    expect(api.requestPasswordReset).not.toHaveBeenCalled();
  });
});

describe('reenvío de /register/check-email con la comprobación', () => {
  type ResendEvent = Parameters<typeof signupCheckPage.actions.resend>[0];

  it.each([
    ['CAPTCHA_REQUIRED', 'captcha-required'],
    ['CAPTCHA_INVALID', 'captcha-invalid'],
  ])('%s vuelve a la página con ?error=%s', async (code, error) => {
    api.requestEmailVerification.mockResolvedValue(failure(400, code));
    const cookies = fakeCookies({ cupidilla_pending_email: 'signup:ana@example.com' });
    const { redirect } = await run(() =>
      signupCheckPage.actions.resend(formEvent<ResendEvent>({ captcha: 'abc=' }, cookies)),
    );
    expect(api.requestEmailVerification).toHaveBeenCalledWith(
      expect.anything(),
      'ana@example.com',
      'abc=',
    );
    expect(redirect).toEqual({ status: 303, location: `/register/check-email?error=${error}` });
  });
});
