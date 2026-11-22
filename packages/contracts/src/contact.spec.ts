import { describe, expect, it } from 'vitest';
import {
  CONTACT_HONEYPOT_FIELD,
  CONTACT_MESSAGE_MAX,
  contactRequestSchema,
  contactTextLength,
} from './contact.js';
import { PRIVACY_POLICY_VERSION } from './consents.js';

const valid = {
  name: 'Lucía Pérez',
  email: 'Lucia@Example.com',
  subject: 'Duda sobre mi cuenta',
  message: 'Hola,\r\nno me llega el correo.',
  acceptPrivacy: true,
  privacyPolicyVersion: PRIVACY_POLICY_VERSION,
};

/** Motivos del primer error de cada campo, como los lee la web. */
function issuesOf(input: Record<string, unknown>): Record<string, string> {
  const result = contactRequestSchema.safeParse(input);
  if (result.success) return {};
  const issues: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? '');
    issues[field] ??= issue.message;
  }
  return issues;
}

const char = (codePoint: number): string => String.fromCodePoint(codePoint);

describe('contactRequestSchema (técnico de contacto §5.1, UX §2.1)', () => {
  it('normaliza: correo en minúsculas, \\r\\n → \\n, NFC y recorte', () => {
    const parsed = contactRequestSchema.parse({
      ...valid,
      name: '  Lucía ',
      subject: `  Cafe${char(0x301)} con dudas  `,
    });
    expect(parsed.email).toBe('lucia@example.com');
    expect(parsed.message).toBe('Hola,\nno me llega el correo.');
    expect(parsed.subject).toBe(`Caf${char(0xe9)} con dudas`);
    expect(parsed.name).toBe('Lucía');
  });

  it('cada campo obligatorio vacío o solo de espacios da required', () => {
    expect(
      issuesOf({ ...valid, name: '  ', subject: '', message: '\n\n  ', acceptPrivacy: false }),
    ).toEqual({
      name: 'required',
      subject: 'required',
      message: 'required',
      acceptPrivacy: 'required',
    });
    expect(issuesOf({ ...valid, email: undefined, privacyPolicyVersion: undefined })).toEqual({
      email: 'required',
      privacyPolicyVersion: 'required',
    });
  });

  it('límites de UX §9.11: nombre 1–100, asunto 3–120, mensaje 10–3000', () => {
    expect(issuesOf({ ...valid, name: 'a'.repeat(100) })).toEqual({});
    expect(issuesOf({ ...valid, name: 'a'.repeat(101) })).toEqual({ name: 'too_long' });
    expect(issuesOf({ ...valid, subject: 'abc' })).toEqual({});
    expect(issuesOf({ ...valid, subject: 'ab' })).toEqual({ subject: 'too_short' });
    expect(issuesOf({ ...valid, subject: 'a'.repeat(120) })).toEqual({});
    expect(issuesOf({ ...valid, subject: 'a'.repeat(121) })).toEqual({ subject: 'too_long' });
    expect(issuesOf({ ...valid, message: 'a'.repeat(10) })).toEqual({});
    expect(issuesOf({ ...valid, message: 'a'.repeat(9) })).toEqual({ message: 'too_short' });
    expect(issuesOf({ ...valid, message: 'a'.repeat(3001) })).toEqual({ message: 'too_long' });
    expect(issuesOf({ ...valid, email: `${'a'.repeat(242)}@example.com` })).toEqual({});
    expect(issuesOf({ ...valid, email: `${'a'.repeat(243)}@example.com` })).toEqual({
      email: 'too_long',
    });
  });

  it('3000 emojis de 4 bytes pasan y 3001 no: se cuentan puntos de código', () => {
    expect(issuesOf({ ...valid, message: '😀'.repeat(CONTACT_MESSAGE_MAX) })).toEqual({});
    expect(issuesOf({ ...valid, message: '😀'.repeat(CONTACT_MESSAGE_MAX + 1) })).toEqual({
      message: 'too_long',
    });
  });

  it('contactTextLength mide igual que el esquema (contador de la web)', () => {
    expect(contactTextLength('  Hola,\r\nqué tal 😀  ')).toBe(15);
    expect(contactTextLength(`e${char(0x301)}`)).toBe(1);
  });

  it('el nombre y el asunto rechazan \\r, \\n, U+2028 y controles bidi (U+202E)', () => {
    for (const bad of ['\r', '\n', char(0x2028), char(0x202e), char(0x2066), '\t']) {
      expect(issuesOf({ ...valid, name: `Eve${bad}Bcc` })).toEqual({ name: 'invalid_format' });
      expect(issuesOf({ ...valid, subject: `Hola${bad}Bcc: victima@example.net` })).toEqual({
        subject: 'invalid_format',
      });
    }
  });

  it('el mensaje admite \\n y \\t, pero no otros controles ni bidi', () => {
    expect(issuesOf({ ...valid, message: 'Línea uno\n\tLínea dos' })).toEqual({});
    expect(issuesOf({ ...valid, message: `Hola ${char(0)} mundo cruel` })).toEqual({
      message: 'invalid_format',
    });
    expect(issuesOf({ ...valid, message: `Hola ${char(0x202e)} mundo cruel` })).toEqual({
      message: 'invalid_format',
    });
  });

  it('teléfono: opcional, 7–15 cifras, espacios seguidos en uno', () => {
    expect(contactRequestSchema.parse({ ...valid, phone: ' +34 600  11 22 33 ' }).phone).toBe(
      '+34 600 11 22 33',
    );
    expect(issuesOf({ ...valid, phone: '+34 (600) 123-456' })).toEqual({});
    expect(issuesOf({ ...valid, phone: '(600) 123-456' })).toEqual({});
    expect(issuesOf({ ...valid, phone: '12345' })).toEqual({ phone: 'invalid_format' });
    expect(issuesOf({ ...valid, phone: '600abc123' })).toEqual({ phone: 'invalid_format' });
    expect(issuesOf({ ...valid, phone: '600-ABC' })).toEqual({ phone: 'invalid_format' });
    expect(issuesOf({ ...valid, phone: '1'.repeat(16) })).toEqual({ phone: 'invalid_format' });
    expect(issuesOf({ ...valid, phone: '' })).toEqual({ phone: 'invalid_format' });
    expect(issuesOf({ ...valid, phone: `600 ${'- '.repeat(14)}123 456` })).toEqual({
      phone: 'too_long',
    });
  });

  it('el campo trampa es opcional y de texto; un campo desconocido da unrecognized', () => {
    expect(CONTACT_HONEYPOT_FIELD).toBe('hp_contact');
    expect(issuesOf({ ...valid, hp_contact: '' })).toEqual({});
    expect(issuesOf({ ...valid, hp_contact: 'http://spam.example' })).toEqual({});
    expect(issuesOf({ ...valid, hp_contact: 'x'.repeat(201) })).toEqual({ hp_contact: 'too_long' });
    expect(issuesOf({ ...valid, website: 'x' })).toEqual({ '': 'unrecognized' });
  });
});
