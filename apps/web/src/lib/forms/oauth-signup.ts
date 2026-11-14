import {
  checkBirthDate,
  oauthSignupRequestSchema,
  type FieldIssue,
  type OAuthSignupRequest,
} from '@cupidilla/contracts';
import { fieldMessages } from '#lib/errors/messages.ts';
import type { TextKey } from '#lib/texts.ts';
import { parseBirthDateParts, type BirthDateProblem, type DatePart } from './birth-date.ts';
import { firstIssueByField, textField, type FormErrors } from './form-data.ts';

export type OAuthSignupField = 'birthDate' | 'acceptTerms';

/** Lo que vuelve a la página tras un error. El correo no: viene del estado pendiente. */
export interface OAuthSignupValues {
  day: string;
  month: string;
  year: string;
  acceptTerms: boolean;
}

export interface OAuthSignupErrors extends FormErrors<OAuthSignupField> {
  dateParts: DatePart[];
}

export type OAuthSignupParse =
  | { kind: 'underage' }
  | { kind: 'invalid'; values: OAuthSignupValues; errors: OAuthSignupErrors }
  | { kind: 'valid'; values: OAuthSignupValues; request: OAuthSignupRequest };

const DATE_PROBLEM_TEXT: Record<BirthDateProblem, TextKey> = {
  empty: 'registro.error.fecha_vacia',
  day: 'registro.error.dia',
  month: 'registro.error.mes',
  year: 'registro.error.anio',
  nonexistent: 'registro.error.fecha_inexistente',
};

const messages = fieldMessages.register;

/** Errores por campo a partir de los motivos del contrato (formulario o API). */
export function oauthSignupErrorsFromIssues(issues: Map<string, FieldIssue>): OAuthSignupErrors {
  const errors: OAuthSignupErrors = { fields: {}, dateParts: [] };
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

/** Valores que se devuelven a la página. */
export function oauthSignupValues(data: FormData): OAuthSignupValues {
  return {
    day: textField(data, 'day'),
    month: textField(data, 'month'),
    year: textField(data, 'year'),
    acceptTerms: textField(data, 'acceptTerms') === 'on',
  };
}

/**
 * Formulario de /register/complete → contrato, en el orden de UX §1.3: forma de los campos →
 * menor (pantalla inmediata aunque haya otros errores) → casilla de condiciones.
 */
export function parseOAuthSignupForm(
  data: FormData,
  pendingToken: string,
  today: string,
  minAge: number,
): OAuthSignupParse {
  const values = oauthSignupValues(data);

  const date = parseBirthDateParts(values.day, values.month, values.year);
  const dateCheck = date.ok ? checkBirthDate(date.date, today, minAge) : null;
  if (dateCheck && !dateCheck.ok && dateCheck.reason === 'UNDERAGE') return { kind: 'underage' };

  const parsed = oauthSignupRequestSchema.safeParse({
    pendingToken,
    birthDate: date.ok ? date.date : undefined,
    acceptTerms: values.acceptTerms,
    termsVersion: textField(data, 'termsVersion'),
  });
  const issues = parsed.success
    ? new Map<string, FieldIssue>()
    : firstIssueByField(parsed.error.issues);
  issues.delete('birthDate');
  const errors = oauthSignupErrorsFromIssues(issues);
  if (!date.ok) {
    errors.fields.birthDate = DATE_PROBLEM_TEXT[date.problem];
    errors.dateParts = date.invalidParts;
  } else if (dateCheck && !dateCheck.ok) {
    errors.fields.birthDate = 'registro.error.fecha_futura';
    errors.dateParts = ['day', 'month', 'year'];
  }

  const hasErrors = errors.general !== undefined || Object.keys(errors.fields).length > 0;
  if (hasErrors || !parsed.success) return { kind: 'invalid', values, errors };
  return { kind: 'valid', values, request: parsed.data };
}
