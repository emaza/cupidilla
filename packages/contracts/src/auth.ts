import { z } from 'zod';
import { MIN_BIRTH_DATE } from './age.js';

export const PASSWORD_MIN = 10; // puntos de código
export const PASSWORD_MAX = 128; // puntos de código
export const EMAIL_MAX = 254;

/**
 * Longitud en puntos de código Unicode, no en unidades UTF-16, tras la normalización NFKC que
 * aplica la API antes de hashear (§8.1): así 'é' compuesta y 'e' + acento cuentan igual.
 * Solo se mide así; el valor que se valida y se envía no cambia.
 */
const codePoints = (value: string): number => [...value.normalize('NFKC')].length;

/**
 * Recorta y pasa a minúsculas antes de validar el formato: así se guarda normalizado.
 * Vacío (o solo espacios) cuenta como ausente: `required`, no `invalid_format`.
 */
export const emailSchema = z
  .string({ error: 'required' })
  .trim()
  .toLowerCase()
  .min(1, { error: 'required', abort: true })
  .max(EMAIL_MAX, { error: 'too_long' })
  .pipe(z.email({ error: 'invalid_format' }));

/** Contraseña nueva (registro). Sin recortes ni reglas de composición. Vacía da `required`. */
export const newPasswordSchema = z
  .string({ error: 'required' })
  .refine((value) => value.length > 0, { error: 'required', abort: true })
  .refine((value) => codePoints(value) >= PASSWORD_MIN, { error: 'too_short' })
  .refine((value) => codePoints(value) <= PASSWORD_MAX, { error: 'too_long' });

/** Contraseña ya existente (login, borrado). No exige el mínimo actual para no bloquear cuentas antiguas. */
export const passwordInputSchema = z
  .string({ error: 'required' })
  .refine((value) => codePoints(value) >= 1, { error: 'required' })
  .refine((value) => codePoints(value) <= PASSWORD_MAX, { error: 'too_long' });

/** Fecha real de calendario 'YYYY-MM-DD'. El futuro y la edad dependen de «hoy» y se comprueban aparte. */
export const birthDateSchema = z.iso
  .date({
    error: (issue) => (issue.input === undefined ? 'required' : 'invalid_format'),
    abort: true,
  })
  .refine((value) => value >= MIN_BIRTH_DATE, { error: 'too_old' });

/** Error de los objetos estrictos: un campo desconocido da `unrecognized`. */
export const strictObjectError = (issue: { code: string }): string =>
  issue.code === 'unrecognized_keys' ? 'unrecognized' : 'invalid';

export const registerRequestSchema = z.strictObject(
  {
    email: emailSchema,
    password: newPasswordSchema,
    birthDate: birthDateSchema,
    acceptTerms: z.literal(true, { error: 'required' }),
    termsVersion: z
      .string({ error: 'required' })
      .min(1, { error: 'required' })
      .max(64, { error: 'too_long' }),
  },
  { error: strictObjectError },
);

export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.strictObject(
  { email: emailSchema, password: passwordInputSchema },
  { error: strictObjectError },
);

export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Usuario tal como lo ve la web. Vive aquí, y no en users.ts, para evitar una importación circular. */
export const publicUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  createdAt: z.iso.datetime(),
});

export type PublicUser = z.infer<typeof publicUserSchema>;

/** Respuesta de registro y login. El token solo viaja aquí. */
export const authResponseSchema = z.object({
  user: publicUserSchema,
  session: z.object({ token: z.string(), expiresAt: z.iso.datetime() }),
});

export type AuthResponse = z.infer<typeof authResponseSchema>;

/** Respuesta de GET /auth/session. */
export const sessionResponseSchema = z.object({
  user: publicUserSchema,
  session: z.object({ expiresAt: z.iso.datetime(), renewed: z.boolean() }),
});

export type SessionResponse = z.infer<typeof sessionResponseSchema>;
