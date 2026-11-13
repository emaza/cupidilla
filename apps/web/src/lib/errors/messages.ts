import { ERROR_CODES, FIELD_ISSUES, type ErrorCode, type FieldIssue } from '@cupidilla/contracts';
import type { TextKey } from '#lib/texts.ts';

/**
 * Código propio de la web, que la API nunca emite. `API_UNAVAILABLE`: la petición no llegó a la
 * API (conexión rechazada) o la API respondió un 5xx sin cuerpo válido.
 *
 * `OUTCOME_UNKNOWN` es un código del contrato (la API lo emite si pierde la conexión con la base
 * de datos durante una escritura), y la web lo usa también cuando una escritura no idempotente
 * se envió y no hubo respuesta. En los dos casos no sabemos si se hizo.
 */
export const WEB_ERROR_CODES = ['API_UNAVAILABLE'] as const;
export type WebErrorCode = ErrorCode | (typeof WEB_ERROR_CODES)[number];

/** Formularios. Cada uno tiene sus propios textos de error (UX §5). */
export type FormName = 'register' | 'login' | 'delete' | 'logout' | 'signup' | 'link';

function byCode(
  fallback: TextKey,
  specific: Partial<Record<WebErrorCode, TextKey>>,
): Record<WebErrorCode, TextKey> {
  const entries = [...ERROR_CODES, ...WEB_ERROR_CODES].map(
    (code) => [code, specific[code] ?? fallback] as const,
  );
  return Object.fromEntries(entries) as Record<WebErrorCode, TextKey>;
}

function byIssue(
  fallback: TextKey,
  specific: Partial<Record<FieldIssue, TextKey>>,
): Record<FieldIssue, TextKey> {
  const entries = FIELD_ISSUES.map((issue) => [issue, specific[issue] ?? fallback] as const);
  return Object.fromEntries(entries) as Record<FieldIssue, TextKey>;
}

/** Código de error de la API → clave del texto general de cada formulario. */
export const errorMessages: Record<FormName, Record<WebErrorCode, TextKey>> = {
  register: byCode('registro.error.servidor', {
    EMAIL_TAKEN: 'registro.error.correo_existente',
    TERMS_VERSION_OUTDATED: 'registro.error.condiciones_version',
    UNDERAGE: 'registro.menor.texto1',
    RATE_LIMITED: 'comun.error.limite',
    OUTCOME_UNKNOWN: 'registro.error.resultado_incierto',
  }),
  login: byCode('entrar.error.servidor', {
    // Un correo mal formado se trata como unas credenciales incorrectas (acuerdo A10).
    VALIDATION_FAILED: 'entrar.error.credenciales',
    INVALID_CREDENTIALS: 'entrar.error.credenciales',
    RATE_LIMITED: 'comun.error.limite',
  }),
  delete: byCode('eliminar.error.servidor', {
    VALIDATION_FAILED: 'eliminar.error.contrasena',
    PASSWORD_INCORRECT: 'eliminar.error.contrasena',
    RATE_LIMITED: 'comun.error.limite',
    OUTCOME_UNKNOWN: 'eliminar.error.resultado_incierto',
  }),
  logout: byCode('cuenta.error.servidor', {}),
  // /register/complete (UX §3.2). Los textos con {proveedor} los completa la página.
  signup: byCode('alta.error.servidor', {
    TERMS_VERSION_OUTDATED: 'registro.error.condiciones_version',
    UNDERAGE: 'registro.menor.texto1',
    RATE_LIMITED: 'comun.error.limite',
    OUTCOME_UNKNOWN: 'alta.error.resultado_incierto',
  }),
  // /login/link (UX §3.3). Los textos con {proveedor} los completa la página.
  link: byCode('union.error.servidor', {
    VALIDATION_FAILED: 'union.error.contrasena',
    PASSWORD_INCORRECT: 'union.error.contrasena',
    LINK_ATTEMPTS_EXCEEDED: 'union.error.limite',
    RATE_LIMITED: 'comun.error.limite',
    OUTCOME_UNKNOWN: 'union.error.resultado_incierto',
  }),
};

/** Campo del contrato + motivo → clave del texto del error de ese campo. */
export const fieldMessages = {
  register: {
    email: byIssue('registro.error.correo_formato', {
      required: 'registro.error.correo_vacio',
      too_long: 'registro.error.correo_largo',
    }),
    password: byIssue('registro.error.contrasena_corta', {
      required: 'registro.error.contrasena_vacia',
      too_long: 'registro.error.contrasena_larga',
    }),
    birthDate: byIssue('registro.error.fecha_inexistente', {
      required: 'registro.error.fecha_vacia',
      too_old: 'registro.error.anio',
      in_future: 'registro.error.fecha_futura',
    }),
    acceptTerms: byIssue('registro.error.condiciones', {}),
    termsVersion: byIssue('registro.error.condiciones_version', {}),
  },
  login: {
    email: byIssue('entrar.error.credenciales', { required: 'entrar.error.correo_vacio' }),
    password: byIssue('entrar.error.credenciales', { required: 'entrar.error.contrasena_vacia' }),
  },
  delete: {
    password: byIssue('eliminar.error.contrasena', {
      required: 'eliminar.error.contrasena_vacia',
    }),
  },
  link: {
    password: byIssue('union.error.contrasena', { required: 'union.error.contrasena_vacia' }),
  },
} as const satisfies Record<string, Record<string, Record<FieldIssue, TextKey>>>;
