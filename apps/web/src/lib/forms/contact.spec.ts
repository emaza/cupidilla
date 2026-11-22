import { PRIVACY_POLICY_VERSION } from '@cupidilla/contracts';
import { describe, expect, it } from 'vitest';
import { errorMessages } from '#lib/errors/messages.ts';
import { contactErrorsFromIssues, parseContactForm } from './contact.ts';

const validForm = {
  name: 'Lucía Pérez',
  email: 'Lucia@Example.com',
  phone: '',
  subject: 'Duda sobre mi cuenta',
  message: 'Hola,\r\nno me llega el correo.',
  acceptPrivacy: 'on',
  privacyVersion: PRIVACY_POLICY_VERSION,
  hp_contact: '',
};

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe('T10: parseContactForm (técnico de contacto §8.3)', () => {
  it('el formulario válido da el cuerpo del contrato, sin teléfono vacío ni campo trampa vacío', () => {
    const parsed = parseContactForm(formData(validForm));
    expect(parsed).toMatchObject({ kind: 'valid', honeypot: false });
    if (parsed.kind !== 'valid') return;
    expect(parsed.request).toEqual({
      name: 'Lucía Pérez',
      email: 'lucia@example.com',
      subject: 'Duda sobre mi cuenta',
      message: 'Hola,\nno me llega el correo.',
      acceptPrivacy: true,
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
    });
  });

  it('un teléfono solo de espacios cuenta como vacío y no se envía', () => {
    const parsed = parseContactForm(formData({ ...validForm, phone: '   ' }));
    expect(parsed.kind === 'valid' && 'phone' in parsed.request).toBe(false);
    const withPhone = parseContactForm(formData({ ...validForm, phone: '+34 600  11 22 33' }));
    expect(withPhone.kind === 'valid' && withPhone.request.phone).toBe('+34 600 11 22 33');
  });

  it('el campo trampa va tal cual a la API (recortado a 200) y marca honeypot', () => {
    const parsed = parseContactForm(formData({ ...validForm, hp_contact: 'x'.repeat(500) }));
    expect(parsed).toMatchObject({ kind: 'valid', honeypot: true });
    expect(parsed.kind === 'valid' && parsed.request.hp_contact).toBe('x'.repeat(200));
  });

  it('vacío: cinco errores en el orden del formulario, sin teléfono (UX §9.7)', () => {
    const parsed = parseContactForm(formData({ privacyVersion: PRIVACY_POLICY_VERSION }));
    expect(parsed.kind).toBe('invalid');
    if (parsed.kind !== 'invalid') return;
    expect(parsed.errors.fields).toEqual({
      name: 'contacto.error.nombre_vacio',
      email: 'registro.error.correo_vacio',
      subject: 'contacto.error.asunto_vacio',
      message: 'contacto.error.mensaje_vacio',
      acceptPrivacy: 'contacto.error.privacidad',
    });
  });

  it('conserva todo lo escrito y la casilla, pero nunca el campo trampa (UX §9.10)', () => {
    const parsed = parseContactForm(
      formData({ ...validForm, subject: 'ab', phone: '12345', hp_contact: 'spam' }),
    );
    expect(parsed.kind).toBe('invalid');
    if (parsed.kind !== 'invalid') return;
    expect(parsed.values).toEqual({
      name: 'Lucía Pérez',
      email: 'Lucia@Example.com',
      phone: '12345',
      subject: 'ab',
      message: 'Hola,\r\nno me llega el correo.',
      acceptPrivacy: true,
    });
    expect(parsed.errors.fields).toEqual({
      phone: 'contacto.error.telefono_formato',
      subject: 'contacto.error.asunto_corto',
    });
  });

  it('límites y formatos dan su texto propio', () => {
    const issues = (fields: Record<string, string>) => {
      const parsed = parseContactForm(formData({ ...validForm, ...fields }));
      return parsed.kind === 'invalid' ? parsed.errors.fields : {};
    };
    expect(issues({ name: 'a'.repeat(101) })).toEqual({ name: 'contacto.error.nombre_largo' });
    expect(issues({ subject: 'a'.repeat(121) })).toEqual({
      subject: 'contacto.error.asunto_largo',
    });
    expect(issues({ subject: 'Hola\tBcc' })).toEqual({ subject: 'contacto.error.asunto_formato' });
    expect(issues({ message: 'corto' })).toEqual({ message: 'contacto.error.mensaje_corto' });
    expect(issues({ message: 'a'.repeat(3001) })).toEqual({
      message: 'contacto.error.mensaje_largo',
    });
    expect(issues({ phone: '600abc123' })).toEqual({ phone: 'contacto.error.telefono_formato' });
    expect(issues({ acceptPrivacy: '' })).toEqual({ acceptPrivacy: 'contacto.error.privacidad' });
    expect(issues({ privacyVersion: '' })).toEqual({
      acceptPrivacy: 'contacto.error.privacidad_version',
    });
  });

  it('los errores de campo de la API se pintan igual que los del formulario', () => {
    const errors = contactErrorsFromIssues(
      new Map([
        ['subject', 'invalid_format'],
        ['privacyPolicyVersion', 'too_long'],
      ]),
    );
    expect(errors.fields).toEqual({
      subject: 'contacto.error.asunto_formato',
      acceptPrivacy: 'contacto.error.privacidad_version',
    });
  });
});

describe('T10: errorMessages.contact (UX de contacto §3.4)', () => {
  it('cada código de la ruta tiene su texto', () => {
    expect(errorMessages.contact.RATE_LIMITED).toBe('contacto.error.limite');
    expect(errorMessages.contact.PRIVACY_VERSION_OUTDATED).toBe(
      'contacto.error.privacidad_version',
    );
    expect(errorMessages.contact.OUTCOME_UNKNOWN).toBe('contacto.error.resultado_incierto');
    for (const code of [
      'INTERNAL_ERROR',
      'API_UNAVAILABLE',
      'MALFORMED_REQUEST',
      'FORBIDDEN',
    ] as const) {
      expect(errorMessages.contact[code]).toBe('contacto.error.servidor');
    }
  });
});
