import { z } from 'zod';
import { emailSchema, strictObjectError, termsVersionSchema } from './auth.js';

/**
 * Formulario de contacto (técnico de contacto §5.1, UX de contacto §2.1). Los límites cuentan
 * puntos de código tras normalizar, igual que `char_length` en PostgreSQL y que el contador de la
 * web: los tres usan estas constantes y `contactTextLength`.
 */
export const CONTACT_NAME_MAX = 100;
export const CONTACT_SUBJECT_MIN = 3;
export const CONTACT_SUBJECT_MAX = 120;
export const CONTACT_MESSAGE_MIN = 10;
export const CONTACT_MESSAGE_MAX = 3000;
/** Caracteres escritos del teléfono (cifras, espacios, `+`, guiones, puntos y paréntesis). */
export const CONTACT_PHONE_MAX = 30;
/** Cifras del teléfono: 15 es el máximo del formato internacional (E.164). */
export const CONTACT_PHONE_DIGITS_MIN = 7;
export const CONTACT_PHONE_DIGITS_MAX = 15;
/** Retención de `contact_messages` (técnico de contacto §9). La usa el barrido. */
export const CONTACT_MESSAGE_RETENTION_DAYS = 180;
/** Nombre del campo trampa en el formulario y en el cuerpo (UX de contacto §2.1.3). */
export const CONTACT_HONEYPOT_FIELD = 'hp_contact';
export const CONTACT_HONEYPOT_MAX = 200;

/** Longitud en puntos de código, como `char_length` de PostgreSQL. Un emoji simple cuenta 1. */
export const codePointLength = (value: string): number => [...value].length;

/** `\r\n` y `\r` pasan a `\n`. */
const normalizeLineBreaks = (value: string): string => value.replace(/\r\n?/g, '\n');

/**
 * Longitud de un texto del formulario tal como la mide el servidor: saltos de línea a `\n`, NFC y
 * sin espacios al principio ni al final. El contador de la web usa esta misma función.
 */
export const contactTextLength = (value: string): number =>
  codePointLength(normalizeLineBreaks(value).normalize('NFC').trim());

/**
 * Caracteres de control (`\p{Cc}`, que incluye `\r` y `\n`), separadores de línea y de párrafo
 * (U+2028, U+2029) y controles bidireccionales (U+202A–U+202E, U+2066–U+2069), que podrían
 * disfrazar un asunto o colarse en una cabecera.
 */
const UNSAFE_TEXT = /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
/** El mensaje admite saltos de línea y tabuladores. */
const ALLOWED_IN_MESSAGE = /[\n\t]/g;

/** Texto de una línea: NFC, recorte, requerido, sin controles ni bidi, mínimo y máximo. */
function singleLineText(min: number, max: number) {
  return z
    .string({ error: 'required' })
    .overwrite((value) => value.normalize('NFC'))
    .trim()
    .min(1, { error: 'required', abort: true })
    .refine((value) => !UNSAFE_TEXT.test(value), { error: 'invalid_format' })
    .refine((value) => codePointLength(value) >= min, { error: 'too_short' })
    .refine((value) => codePointLength(value) <= max, { error: 'too_long' });
}

/** Mensaje: como `singleLineText`, pero antes cambia `\r\n` y `\r` por `\n` y admite `\n` y `\t`. */
function multiLineText(min: number, max: number) {
  return z
    .string({ error: 'required' })
    .overwrite((value) => normalizeLineBreaks(value).normalize('NFC'))
    .trim()
    .min(1, { error: 'required', abort: true })
    .refine((value) => !UNSAFE_TEXT.test(value.replace(ALLOWED_IN_MESSAGE, '')), {
      error: 'invalid_format',
    })
    .refine((value) => codePointLength(value) >= min, { error: 'too_short' })
    .refine((value) => codePointLength(value) <= max, { error: 'too_long' });
}

const PHONE_CHARACTERS = /^\+?[0-9 ().-]+$/;

/**
 * Teléfono opcional: recorte y espacios seguidos en uno. Cifras, espacios, guiones, puntos,
 * paréntesis y un `+` inicial, con 7 a 15 cifras. Vacío da `invalid_format`: la web no lo envía.
 */
const phoneSchema = z
  .string({ error: 'invalid_format' })
  .trim()
  .overwrite((value) => value.replace(/\s+/g, ' '))
  .refine((value) => PHONE_CHARACTERS.test(value), { error: 'invalid_format', abort: true })
  .refine(
    (value) => {
      const digits = value.replace(/\D/g, '').length;
      return digits >= CONTACT_PHONE_DIGITS_MIN && digits <= CONTACT_PHONE_DIGITS_MAX;
    },
    { error: 'invalid_format' },
  )
  .refine((value) => codePointLength(value) <= CONTACT_PHONE_MAX, { error: 'too_long' });

/** POST /contact. Responde `202` sin cuerpo, también si el campo trampa llega relleno. */
export const contactRequestSchema = z.strictObject(
  {
    name: singleLineText(1, CONTACT_NAME_MAX),
    email: emailSchema,
    // La web no lo envía si está vacío.
    phone: phoneSchema.optional(),
    subject: singleLineText(CONTACT_SUBJECT_MIN, CONTACT_SUBJECT_MAX),
    message: multiLineText(CONTACT_MESSAGE_MIN, CONTACT_MESSAGE_MAX),
    acceptPrivacy: z.literal(true, { error: 'required' }),
    privacyPolicyVersion: termsVersionSchema,
    // Trampa: vacío o ausente = persona. Lo decide la API (técnico de contacto A4).
    [CONTACT_HONEYPOT_FIELD]: z
      .string({ error: 'invalid' })
      .max(CONTACT_HONEYPOT_MAX, { error: 'too_long' })
      .optional(),
  },
  { error: strictObjectError },
);

export type ContactRequest = z.infer<typeof contactRequestSchema>;
