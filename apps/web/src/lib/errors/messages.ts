import { ERROR_CODES, FIELD_ISSUES, type ErrorCode, type FieldIssue } from '@cupidilla/contracts';
import type { TextKey } from '#lib/texts.ts';

/** Código propio de la web: fallo de red, tiempo agotado o 5xx sin cuerpo válido. La API nunca lo emite. */
export type WebErrorCode = ErrorCode | 'API_UNAVAILABLE';

/** Formularios de H0. Cada uno tiene sus propios textos de error (UX §5). */
export type FormName = 'registro' | 'entrar' | 'eliminar' | 'salir';

function byCode(
  fallback: TextKey,
  specific: Partial<Record<WebErrorCode, TextKey>>,
): Record<WebErrorCode, TextKey> {
  const entries = [...ERROR_CODES, 'API_UNAVAILABLE' as const].map(
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
  registro: byCode('registro.error.servidor', {
    EMAIL_TAKEN: 'registro.error.correo_existente',
    TERMS_VERSION_OUTDATED: 'registro.error.condiciones_version',
    UNDERAGE: 'registro.menor.texto1',
    RATE_LIMITED: 'comun.error.limite',
  }),
  entrar: byCode('entrar.error.servidor', {
    // Un correo mal formado se trata como unas credenciales incorrectas (acuerdo A10).
    VALIDATION_FAILED: 'entrar.error.credenciales',
    INVALID_CREDENTIALS: 'entrar.error.credenciales',
    RATE_LIMITED: 'comun.error.limite',
  }),
  eliminar: byCode('eliminar.error.servidor', {
    VALIDATION_FAILED: 'eliminar.error.contrasena',
    PASSWORD_INCORRECT: 'eliminar.error.contrasena',
    RATE_LIMITED: 'comun.error.limite',
  }),
  salir: byCode('cuenta.error.servidor', {}),
};

/** Campo del contrato + motivo → clave del texto del error de ese campo. */
export const fieldMessages = {
  registro: {
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
  entrar: {
    email: byIssue('entrar.error.credenciales', { required: 'entrar.error.correo_vacio' }),
    password: byIssue('entrar.error.credenciales', { required: 'entrar.error.contrasena_vacia' }),
  },
  eliminar: {
    password: byIssue('eliminar.error.contrasena', {
      required: 'eliminar.error.contrasena_vacia',
    }),
  },
} as const satisfies Record<string, Record<string, Record<FieldIssue, TextKey>>>;
