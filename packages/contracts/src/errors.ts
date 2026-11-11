import { z } from 'zod';

/** Códigos de error que emite la API. Son lo único que la web usa para elegir el texto. */
export const ERROR_CODES = [
  'VALIDATION_FAILED', // 400
  'MALFORMED_REQUEST', // 400  JSON ilegible, cuerpo demasiado grande
  'UNAUTHENTICATED', // 401  sin sesión, sesión inválida o caducada
  'INVALID_CREDENTIALS', // 401  login: correo o contraseña incorrectos (indistinguibles)
  'PASSWORD_INCORRECT', // 403  borrado de cuenta con contraseña errónea (la sesión sigue válida)
  'FORBIDDEN', // 403  falta la clave interna o no es válida
  'NOT_FOUND', // 404
  'EMAIL_TAKEN', // 409
  'TERMS_VERSION_OUTDATED', // 409
  'UNDERAGE', // 422
  'RATE_LIMITED', // 429  con cabecera Retry-After
  'INTERNAL_ERROR', // 500
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Motivos por los que un campo no es válido. Los esquemas los usan como mensaje de error. */
export const FIELD_ISSUES = [
  'required',
  'invalid_format',
  'too_short',
  'too_long',
  'too_old',
  'in_future',
  'unrecognized',
  'invalid',
] as const;

export type FieldIssue = (typeof FIELD_ISSUES)[number];

export function isFieldIssue(value: unknown): value is FieldIssue {
  return typeof value === 'string' && (FIELD_ISSUES as readonly string[]).includes(value);
}

export const fieldErrorSchema = z.object({
  path: z.string(),
  issue: z.enum(FIELD_ISSUES),
});

export type FieldError = z.infer<typeof fieldErrorSchema>;

/** Forma única de todas las respuestas de error de la API. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string().optional(),
    fields: z.array(fieldErrorSchema).optional(),
  }),
});

export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
export type ApiError = ApiErrorBody['error'];
