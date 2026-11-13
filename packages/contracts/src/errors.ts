import { z } from 'zod';

/** Códigos de error que emite la API. Son lo único que la web usa para elegir el texto. */
export const ERROR_CODES = [
  'VALIDATION_FAILED', // 400
  'MALFORMED_REQUEST', // 400  JSON ilegible, cuerpo demasiado grande
  'OAUTH_FLOW_INVALID', // 400  flujo o estado pendiente inexistente, caducado, ya usado o ajeno
  'UNAUTHENTICATED', // 401  sin sesión, sesión inválida o caducada
  'INVALID_CREDENTIALS', // 401  login: correo o contraseña incorrectos (indistinguibles)
  'PASSWORD_INCORRECT', // 403  contraseña errónea con sesión o estado pendiente (borrado, unión…)
  'LINK_ATTEMPTS_EXCEEDED', // 403  5.º fallo de contraseña en una unión; el estado pendiente ya no existe
  'REAUTHENTICATION_REQUIRED', // 403  la operación exige una sesión autenticada hace menos de 10 min
  'FORBIDDEN', // 403  falta la clave interna o no es válida
  'NOT_FOUND', // 404
  'EMAIL_TAKEN', // 409
  'TERMS_VERSION_OUTDATED', // 409
  'ACCOUNT_USES_OTHER_PROVIDER', // 409  alta con proveedor contra una cuenta sin contraseña
  'LAST_SIGN_IN_METHOD', // 409  quitar la última forma de entrar
  'PASSWORD_ALREADY_SET', // 409  crear una contraseña cuando ya hay una
  'UNDERAGE', // 422
  'RATE_LIMITED', // 429  con cabecera Retry-After
  'INTERNAL_ERROR', // 500
  'OUTCOME_UNKNOWN', // 503  se perdió la conexión con la BD durante una escritura: pudo hacerse o no
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
