import {
  checkBirthDate,
  dataReviewRequestSchema,
  SERVICE_TERMS_VERSION,
  type DataReviewRequest,
  type FieldIssue,
} from '@cupidilla/contracts';
import { fieldMessages } from '#lib/errors/messages.ts';
import type { TextKey } from '#lib/texts.ts';
import { parseBirthDateParts, type BirthDateProblem, type DatePart } from './birth-date.ts';
import { firstIssueByField, textField, type FormErrors } from './form-data.ts';

export type DataReviewField = 'birthDate' | 'acceptTerms';

/** Lo que vuelve a la página tras un error: día, mes, año y casilla (UX §3.10). */
export interface DataReviewValues {
  day: string;
  month: string;
  year: string;
  acceptTerms: boolean;
}

export interface DataReviewErrors extends FormErrors<DataReviewField> {
  dateParts: DatePart[];
}

export type DataReviewParse =
  | { kind: 'underage'; request: DataReviewRequest }
  | { kind: 'invalid'; values: DataReviewValues; errors: DataReviewErrors }
  | { kind: 'valid'; request: DataReviewRequest };

const DATE_PROBLEM_TEXT: Record<BirthDateProblem, TextKey> = {
  empty: 'registro.error.fecha_vacia',
  day: 'registro.error.dia',
  month: 'registro.error.mes',
  year: 'registro.error.anio',
  nonexistent: 'registro.error.fecha_inexistente',
};

const messages = fieldMessages.register;

export function dataReviewValues(data: FormData): DataReviewValues {
  return {
    day: textField(data, 'day'),
    month: textField(data, 'month'),
    year: textField(data, 'year'),
    acceptTerms: textField(data, 'acceptTerms') === 'on',
  };
}

/** Errores por campo a partir de los motivos del contrato (de la web o de la API). */
export function dataReviewErrorsFromIssues(issues: Map<string, FieldIssue>): DataReviewErrors {
  const errors: DataReviewErrors = { fields: {}, dateParts: [] };
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

/**
 * Convierte el formulario de /account/review al contrato, en el orden de H0 §1.2: forma de los
 * campos → menor → versión → casilla. Si la fecha es real y de un menor, el resultado es
 * `underage` aunque haya otros errores: la API tiene que borrar la cuenta y no vuelve ningún valor.
 */
export function parseDataReviewForm(
  data: FormData,
  today: string,
  minAge: number,
): DataReviewParse {
  const values = dataReviewValues(data);
  const date = parseBirthDateParts(values.day, values.month, values.year);
  const dateCheck = date.ok ? checkBirthDate(date.date, today, minAge) : null;
  if (date.ok && dateCheck && !dateCheck.ok && dateCheck.reason === 'UNDERAGE') {
    // La API comprueba la edad antes que nada y, con un menor, borra la cuenta sin guardar ninguna
    // aceptación; el cuerpo solo tiene que pasar su esquema aunque la casilla falte.
    return {
      kind: 'underage',
      request: { birthDate: date.date, acceptTerms: true, termsVersion: SERVICE_TERMS_VERSION },
    };
  }

  const parsed = dataReviewRequestSchema.safeParse({
    birthDate: date.ok ? date.date : undefined,
    acceptTerms: values.acceptTerms,
    termsVersion: textField(data, 'termsVersion'),
  });
  const issues = parsed.success
    ? new Map<string, FieldIssue>()
    : firstIssueByField(parsed.error.issues);
  // La fecha se valida por partes; el esquema solo se usa para el resto de campos.
  issues.delete('birthDate');
  const errors = dataReviewErrorsFromIssues(issues);
  if (!date.ok) {
    errors.fields.birthDate = DATE_PROBLEM_TEXT[date.problem];
    errors.dateParts = date.invalidParts;
  } else if (dateCheck && !dateCheck.ok) {
    errors.fields.birthDate = 'registro.error.fecha_futura';
    errors.dateParts = ['day', 'month', 'year'];
  }
  const hasErrors = Object.keys(errors.fields).length > 0;
  if (hasErrors || !parsed.success) return { kind: 'invalid', values, errors };
  return { kind: 'valid', request: parsed.data };
}
