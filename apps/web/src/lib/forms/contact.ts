import {
  CONTACT_HONEYPOT_FIELD,
  CONTACT_HONEYPOT_MAX,
  contactRequestSchema,
  type ContactRequest,
  type FieldIssue,
} from '@cupidilla/contracts';
import { fieldMessages } from '#lib/errors/messages.ts';
import { firstIssueByField, textField, type FormErrors } from './form-data.ts';

/** Campos del formulario de /contact con error propio, en el orden visual (contacto UX §3.4). */
export const CONTACT_FIELDS = [
  'name',
  'email',
  'phone',
  'subject',
  'message',
  'acceptPrivacy',
] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];

/** Campo oculto con la versión de la política, como `termsVersion` (contacto UX §2.1). */
export const PRIVACY_VERSION_FIELD = 'privacyVersion';

/** Lo que vuelve a la página tras un error: todo lo escrito, nunca el campo trampa (UX §2.1.4). */
export interface ContactValues {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
  acceptPrivacy: boolean;
}

export type ContactParse =
  | { kind: 'invalid'; values: ContactValues; errors: FormErrors<ContactField> }
  | { kind: 'valid'; values: ContactValues; request: ContactRequest; honeypot: boolean };

const messages = fieldMessages.contact;

/** Errores por campo del HTML a partir de los motivos por campo del contrato (o de la API). */
export function contactErrorsFromIssues(issues: Map<string, FieldIssue>): FormErrors<ContactField> {
  const errors: FormErrors<ContactField> = { fields: {} };
  for (const field of CONTACT_FIELDS) {
    const issue = issues.get(field);
    if (issue) errors.fields[field] = messages[field][issue];
  }
  const version = issues.get('privacyPolicyVersion');
  if (!errors.fields.acceptPrivacy && version) {
    errors.fields.acceptPrivacy = messages.privacyPolicyVersion[version];
  }
  return errors;
}

export function contactValues(data: FormData): ContactValues {
  return {
    name: textField(data, 'name'),
    email: textField(data, 'email'),
    phone: textField(data, 'phone'),
    subject: textField(data, 'subject'),
    message: textField(data, 'message'),
    acceptPrivacy: textField(data, 'acceptPrivacy') === 'on',
  };
}

/**
 * Convierte el formulario de /contact al contrato (técnico de contacto §8.3). El teléfono vacío no
 * se envía. El campo trampa va tal cual (recortado al máximo del contrato): lo decide la API, y así
 * el bot cuenta para sus límites (A4). `honeypot` solo sirve para no prometer un acuse.
 */
export function parseContactForm(data: FormData): ContactParse {
  const values = contactValues(data);
  const trap = textField(data, CONTACT_HONEYPOT_FIELD).slice(0, CONTACT_HONEYPOT_MAX);
  const candidate = {
    name: values.name,
    email: values.email,
    ...(values.phone.trim() === '' ? {} : { phone: values.phone }),
    subject: values.subject,
    message: values.message,
    acceptPrivacy: values.acceptPrivacy,
    privacyPolicyVersion: textField(data, PRIVACY_VERSION_FIELD),
    ...(trap === '' ? {} : { [CONTACT_HONEYPOT_FIELD]: trap }),
  };
  const parsed = contactRequestSchema.safeParse(candidate);
  if (!parsed.success) {
    const errors = contactErrorsFromIssues(firstIssueByField(parsed.error.issues));
    return { kind: 'invalid', values, errors };
  }
  return { kind: 'valid', values, request: parsed.data, honeypot: trap.trim() !== '' };
}
