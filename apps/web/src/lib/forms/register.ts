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

export type RegisterField = 'email' | 'password' | 'birthDate' | 'acceptTerms';

/** Lo que vuelve a la página tras un error. Nunca la contraseña (acuerdo A5). */
export interface RegisterValues {
  email: string;
  day: string;
  month: string;
  year: string;
  acceptTerms: boolean;
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

const messages = fieldMessages.register;

/** Errores por campo del HTML a partir de los motivos por campo del contrato. */
export function registerErrorsFromIssues(issues: Map<string, FieldIssue>): RegisterErrors {
  const errors: RegisterErrors = { fields: {}, dateParts: [] };
  const email = issues.get('email');
  if (email) errors.fields.email = messages.email[email];
  const password = issues.get('password');
  if (password) errors.fields.password = messages.password[password];
  const birthDate = issues.get('birthDate');
  if (birthDate) {
    errors.fields.birthDate = messages.birthDate[birthDate];
    errors.dateParts = ['day', 'month', 'year'];
  }
  const terms = issues.get('acceptTerms');
  const version = issues.get('termsVersion');
  if (terms) errors.fields.acceptTerms = messages.acceptTerms[terms];
  else if (version) errors.fields.acceptTerms = messages.termsVersion[version];
  return errors;
}

export function hasErrors(errors: FormErrors<string>): boolean {
  return errors.general !== undefined || Object.keys(errors.fields).length > 0;
}

/** Valores que se devuelven a la página (nunca la contraseña). */
export function registerValues(data: FormData): RegisterValues {
  return {
    email: textField(data, 'email'),
    day: textField(data, 'day'),
    month: textField(data, 'month'),
    year: textField(data, 'year'),
    acceptTerms: textField(data, 'acceptTerms') === 'on',
  };
}

/**
 * Convierte el formulario de /register al contrato (acuerdos A1 a A3).
 * Si los tres campos de la fecha componen una fecha real de un menor, el resultado es `underage`
 * aunque haya otros errores: así no vuelve ningún dato.
 */
export function parseRegisterForm(data: FormData, today: string, minAge: number): RegisterParse {
  const values = registerValues(data);

  const date = parseBirthDateParts(values.day, values.month, values.year);
  const dateCheck = date.ok ? checkBirthDate(date.date, today, minAge) : null;
  if (dateCheck && !dateCheck.ok && dateCheck.reason === 'UNDERAGE') return { kind: 'underage' };

  const candidate = {
    email: values.email,
    password: textField(data, 'password'),
    birthDate: date.ok ? date.date : undefined,
    acceptTerms: values.acceptTerms,
    termsVersion: textField(data, 'termsVersion'),
  };
  const parsed = registerRequestSchema.safeParse(candidate);
  const issues = parsed.success
    ? new Map<string, FieldIssue>()
    : firstIssueByField(parsed.error.issues);

  // La fecha se valida por partes; el esquema solo se usa para el resto de campos.
  issues.delete('birthDate');
  const errors = registerErrorsFromIssues(issues);
  if (!date.ok) {
    errors.fields.birthDate = DATE_PROBLEM_TEXT[date.problem];
    errors.dateParts = date.invalidParts;
  } else if (dateCheck && !dateCheck.ok) {
    errors.fields.birthDate = 'registro.error.fecha_futura';
    errors.dateParts = ['day', 'month', 'year'];
  }

  if (hasErrors(errors) || !parsed.success) return { kind: 'invalid', values, errors };
  return { kind: 'valid', values, request: parsed.data };
}
