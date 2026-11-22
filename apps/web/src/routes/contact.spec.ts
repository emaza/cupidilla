import { PRIVACY_POLICY_VERSION } from '@cupidilla/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// La puerta a la API y la configuración se sustituyen: aquí se prueba qué hace la acción con cada
// respuesta y qué guarda en la cookie de /contact/sent.
const api = vi.hoisted(() => ({ sendContactMessage: vi.fn() }));
const config = vi.hoisted(() => ({ ackEmail: false }));
vi.mock('#lib/server/api-client.ts', () => ({ api }));
vi.mock('#lib/server/min-age.ts', () => ({
  displayContactConfig: () => Promise.resolve({ ackEmail: config.ackEmail }),
}));

const contactPage = await import('./contact/+page.server.ts');
const sentPage = await import('./contact/sent/+page.server.ts');
const { CONTACT_SENT_COOKIE } = await import('#lib/server/contact-cookie.ts');

type ContactEvent = Parameters<typeof contactPage.actions.default>[0];
type SentEvent = Parameters<typeof sentPage.load>[0];

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

const validForm = {
  name: 'Lucía Pérez',
  email: 'Lucia@Example.com',
  subject: 'Duda sobre mi cuenta',
  message: 'Hola,\r\nno me llega el correo.',
  acceptPrivacy: 'on',
  privacyVersion: PRIVACY_POLICY_VERSION,
};

function formEvent(fields: Record<string, string>): ContactEvent {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return {
    request: { formData: () => Promise.resolve(data) },
    cookies,
    locals: { user: null, sessionToken: null },
    getClientAddress: () => '127.0.0.1',
  } as unknown as ContactEvent;
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

const failure = (status: number, code: string, fields?: unknown) => ({
  ok: false,
  status,
  error: { code, fields },
});

beforeEach(() => {
  vi.clearAllMocks();
  cookies = fakeCookies();
  config.ackEmail = false;
});

describe('T10: acción de /contact', () => {
  it('C1: con 202, 303 a /contact/sent y la cookie lleva el correo normalizado y ack=0', async () => {
    api.sendContactMessage.mockResolvedValue({ ok: true, status: 202, data: undefined });
    const { redirect } = await run(() => contactPage.actions.default(formEvent(validForm)));
    expect(redirect).toEqual({ status: 303, location: '/contact/sent' });
    expect(api.sendContactMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: 'lucia@example.com', acceptPrivacy: true }),
    );
    const cookie = cookies.jar.get(CONTACT_SENT_COOKIE);
    expect(cookie?.value).toBe('0:lucia@example.com');
    expect(cookie?.options).toMatchObject({
      path: '/contact/sent',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 900,
    });
  });

  it('C2: con el acuse activado, ack=1; con el campo trampa, ack=0 aunque esté activado', async () => {
    config.ackEmail = true;
    api.sendContactMessage.mockResolvedValue({ ok: true, status: 202, data: undefined });
    await run(() => contactPage.actions.default(formEvent(validForm)));
    expect(cookies.jar.get(CONTACT_SENT_COOKIE)?.value).toBe('1:lucia@example.com');

    const { redirect } = await run(() =>
      contactPage.actions.default(formEvent({ ...validForm, hp_contact: 'http://spam.example' })),
    );
    expect(redirect).toEqual({ status: 303, location: '/contact/sent' });
    // La API decide: el campo trampa le llega tal cual.
    expect(api.sendContactMessage).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ hp_contact: 'http://spam.example' }),
    );
    expect(cookies.jar.get(CONTACT_SENT_COOKIE)?.value).toBe('0:lucia@example.com');
  });

  it('C5: con errores no llama a la API y devuelve 400 con lo escrito', async () => {
    const { result } = await run(() =>
      contactPage.actions.default(formEvent({ ...validForm, name: '' })),
    );
    expect(api.sendContactMessage).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 400,
      data: {
        values: { message: validForm.message, acceptPrivacy: true },
        errors: { fields: { name: 'contacto.error.nombre_vacio' } },
      },
    });
  });

  it('C10: una versión vieja pinta el error en la casilla y la devuelve desmarcada', async () => {
    api.sendContactMessage.mockResolvedValue(failure(409, 'PRIVACY_VERSION_OUTDATED'));
    const { result } = await run(() => contactPage.actions.default(formEvent(validForm)));
    expect(result).toMatchObject({
      status: 409,
      data: {
        values: { acceptPrivacy: false, message: validForm.message },
        errors: { fields: { acceptPrivacy: 'contacto.error.privacidad_version' } },
      },
    });
  });

  it.each([
    [429, 'RATE_LIMITED', 'contacto.error.limite'],
    [503, 'OUTCOME_UNKNOWN', 'contacto.error.resultado_incierto'],
    [503, 'API_UNAVAILABLE', 'contacto.error.servidor'],
    [500, 'INTERNAL_ERROR', 'contacto.error.servidor'],
  ])('%i %s: error general %s y lo escrito se conserva', async (status, code, text) => {
    api.sendContactMessage.mockResolvedValue(failure(status, code));
    const { result } = await run(() => contactPage.actions.default(formEvent(validForm)));
    expect(result).toMatchObject({
      status,
      data: { values: { subject: validForm.subject }, errors: { fields: {}, general: text } },
    });
    expect(cookies.jar.has(CONTACT_SENT_COOKIE)).toBe(false);
  });

  it('un 400 de campos de la API se pinta en su campo', async () => {
    api.sendContactMessage.mockResolvedValue(
      failure(400, 'VALIDATION_FAILED', [{ path: 'subject', issue: 'invalid_format' }]),
    );
    const { result } = await run(() => contactPage.actions.default(formEvent(validForm)));
    expect(result).toMatchObject({
      status: 400,
      data: { errors: { fields: { subject: 'contacto.error.asunto_formato' } } },
    });
  });

  it('C19: con sesión, el correo viene relleno; sin ella, vacío', () => {
    const load = contactPage.load as unknown as (event: unknown) => { email: string };
    expect(load({ locals: { user: { email: 'ana@example.com' } } })).toEqual({
      email: 'ana@example.com',
    });
    expect(load({ locals: { user: null } })).toEqual({ email: '' });
  });
});

describe('T10: /contact/sent', () => {
  const load = (initial: Record<string, string>) => {
    cookies = fakeCookies(initial);
    return run(() => sentPage.load({ cookies } as unknown as SentEvent));
  };

  it('lee la cookie y la borra: una recarga vuelve a /contact', async () => {
    const first = await load({ [CONTACT_SENT_COOKIE]: '1:lucia@example.com' });
    expect(first.result).toEqual({ email: 'lucia@example.com', ack: true });
    expect(cookies.jar.has(CONTACT_SENT_COOKIE)).toBe(false);
    const again = await run(() => sentPage.load({ cookies } as unknown as SentEvent));
    expect(again.redirect).toEqual({ status: 303, location: '/contact' });
  });

  it('sin cookie o con una cookie mal formada, 303 a /contact', async () => {
    expect((await load({})).redirect).toEqual({ status: 303, location: '/contact' });
    expect((await load({ [CONTACT_SENT_COOKIE]: 'basura' })).redirect).toEqual({
      status: 303,
      location: '/contact',
    });
  });
});
