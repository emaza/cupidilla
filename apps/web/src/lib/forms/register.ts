import {
  checkBirthDate,
  registerRequestSchema,
  type FieldIssue,
  type RegisterRequest,
} from '@cupidilla/contracts';
import { fieldMessages } from '#lib/errors/messages.ts';
import type { TextKey } from '#lib/texts.ts';
import { parseBirthDateParts, type BirthDateProblem, type DatePart } from './birth-date.ts';
import { firstIssueByField, textField, type FormErrors } from './form-data.ts';

export type RegisterField = 'correo' | 'contrasena' | 'fecha' | 'condiciones';

/** Lo que vuelve a la página tras un error. Nunca la contraseña (acuerdo A5). */
export interface RegisterValues {
  correo: string;
  dia: string;
  mes: string;
  anio: string;
  condiciones: boolean;
}

export interface RegisterErrors extends FormErrors<RegisterField> {
  /** Partes de la fecha que se marcan como erróneas. */
  dateParts: DatePart[];
}

export type RegisterParse =
  | { kind: 'underage' }
  | { kind: 'invalid'; values: RegisterValues; errors: RegisterErrors }
  | { kind: 'valid'; values: RegisterValues; request: RegisterRequest };

const DATE_PROBLEM_TEXT: Record<BirthDateProblem, TextKey> = {
  empty: 'registro.error.fecha_vacia',
  day: 'registro.error.dia',
  month: 'registro.error.mes',
  year: 'registro.error.anio',
  nonexistent: 'registro.error.fecha_inexistente',
};

const messages = fieldMessages.registro;

/** Errores por campo del HTML a partir de los motivos por campo del contrato. */
export function registerErrorsFromIssues(issues: Map<string, FieldIssue>): RegisterErrors {
  const errors: RegisterErrors = { fields: {}, dateParts: [] };
  const email = issues.get('email');
  if (email) errors.fields.correo = messages.email[email];
  const password = issues.get('password');
  if (password) errors.fields.contrasena = messages.password[password];
  const birthDate = issues.get('birthDate');
  if (birthDate) {
    errors.fields.fecha = messages.birthDate[birthDate];
    errors.dateParts = ['dia', 'mes', 'anio'];
  }
  const terms = issues.get('acceptTerms');
  const version = issues.get('termsVersion');
  if (terms) errors.fields.condiciones = messages.acceptTerms[terms];
  else if (version) errors.fields.condiciones = messages.termsVersion[version];
  return errors;
}

export function hasErrors(errors: FormErrors<string>): boolean {
  return errors.general !== undefined || Object.keys(errors.fields).length > 0;
}

/**
 * Convierte el formulario de /registro al contrato (acuerdos A1 a A3).
 * Si los tres campos de la fecha componen una fecha real de un menor, el resultado es `underage`
 * aunque haya otros errores: así no vuelve ningún dato.
 */
export function parseRegisterForm(data: FormData, today: string): RegisterParse {
  const values: RegisterValues = {
    correo: textField(data, 'correo'),
    dia: textField(data, 'dia'),
    mes: textField(data, 'mes'),
    anio: textField(data, 'anio'),
    condiciones: textField(data, 'condiciones') === 'on',
  };

  const date = parseBirthDateParts(values.dia, values.mes, values.anio);
  const dateCheck = date.ok ? checkBirthDate(date.date, today) : null;
  if (dateCheck && !dateCheck.ok && dateCheck.reason === 'UNDERAGE') return { kind: 'underage' };

  const candidate = {
    email: values.correo,
    password: textField(data, 'contrasena'),
    birthDate: date.ok ? date.date : undefined,
    acceptTerms: values.condiciones,
    termsVersion: textField(data, 'version_condiciones'),
  };
  const parsed = registerRequestSchema.safeParse(candidate);
  const issues = parsed.success
    ? new Map<string, FieldIssue>()
    : firstIssueByField(parsed.error.issues);

  // La fecha se valida por partes; el esquema solo se usa para el resto de campos.
  issues.delete('birthDate');
  const errors = registerErrorsFromIssues(issues);
  if (!date.ok) {
    errors.fields.fecha = DATE_PROBLEM_TEXT[date.problem];
    errors.dateParts = date.invalidParts;
  } else if (dateCheck && !dateCheck.ok) {
    errors.fields.fecha = 'registro.error.fecha_futura';
    errors.dateParts = ['dia', 'mes', 'anio'];
  }

  if (hasErrors(errors) || !parsed.success) return { kind: 'invalid', values, errors };
  return { kind: 'valid', values, request: parsed.data };
}
