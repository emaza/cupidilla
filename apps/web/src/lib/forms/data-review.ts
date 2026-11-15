import type { DataReviewRequest, FieldIssue } from '@cupidilla/contracts';
import { fieldMessages } from '#lib/errors/messages.ts';
import type { TextKey } from '#lib/texts.ts';
import { parseBirthDateParts, type BirthDateProblem, type DatePart } from './birth-date.ts';
import { textField, type FormErrors } from './form-data.ts';

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
  | { kind: 'invalid'; values: DataReviewValues; errors: DataReviewErrors }
  | { kind: 'valid'; values: DataReviewValues; request: DataReviewRequest };

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
 * Convierte el formulario de /account/review al contrato. La web solo comprueba la forma de la
 * fecha: si es una fecha real y no futura, la petición sale **siempre**, con la casilla tal como
 * está. Quién es menor lo decide solo la API (con su `MIN_AGE`, que puede no coincidir con el de
 * la caché de la web): con un menor borra la cuenta aunque falte la casilla, y a un adulto sin la
 * casilla le responde `acceptTerms: required` (correo §5.11, UX §9 escenario 51).
 */
export function parseDataReviewForm(data: FormData, today: string): DataReviewParse {
  const values = dataReviewValues(data);
  const date = parseBirthDateParts(values.day, values.month, values.year);
  if (date.ok && date.date <= today) {
    return {
      kind: 'valid',
      values,
      request: {
        birthDate: date.date,
        ...(values.acceptTerms ? { acceptTerms: true } : {}),
        termsVersion: textField(data, 'termsVersion'),
      },
    };
  }
  // Sin una fecha que enviar, los errores de la fecha y de la casilla se pintan sin llamar a la API.
  const errors: DataReviewErrors = date.ok
    ? { fields: { birthDate: 'registro.error.fecha_futura' }, dateParts: ['day', 'month', 'year'] }
    : { fields: { birthDate: DATE_PROBLEM_TEXT[date.problem] }, dateParts: date.invalidParts };
  if (!values.acceptTerms) errors.fields.acceptTerms = messages.acceptTerms.required;
  return { kind: 'invalid', values, errors };
}
