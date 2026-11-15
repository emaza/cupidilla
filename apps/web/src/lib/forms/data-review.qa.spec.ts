import { SERVICE_TERMS_VERSION } from '@cupidilla/contracts';
import { describe, expect, it } from 'vitest';
import { parseDataReviewForm } from './data-review.ts';

const TODAY = '2026-11-12';
const form = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const base = { day: '5', month: '5', year: '1990', termsVersion: SERVICE_TERMS_VERSION };

/**
 * QA fase C, desviación 2 (corregida por el CTO): la web no decide quién es menor ni fuerza la
 * casilla. Con una fecha real y no futura, la petición sale siempre con la casilla tal como está.
 */
describe('parseDataReviewForm: consentimiento', () => {
  it('casilla desmarcada o con un valor raro: la petición sale sin acceptTerms, nunca con true', () => {
    for (const acceptTerms of [undefined, '', 'off', 'true', '1']) {
      const fields: Record<string, string> = { ...base };
      if (acceptTerms !== undefined) fields.acceptTerms = acceptTerms;
      const parsed = parseDataReviewForm(form(fields), TODAY);
      expect(parsed.kind, String(acceptTerms)).toBe('valid');
      if (parsed.kind === 'valid') expect(parsed.request.acceptTerms).toBeUndefined();
    }
  });

  it('casilla marcada: acceptTerms true', () => {
    const parsed = parseDataReviewForm(form({ ...base, acceptTerms: 'on' }), TODAY);
    expect(parsed).toMatchObject({ kind: 'valid', request: { acceptTerms: true } });
  });

  it('una fecha de menor con la casilla desmarcada también llega a la API, sin aceptación', () => {
    const parsed = parseDataReviewForm(form({ ...base, year: '2015' }), TODAY);
    expect(parsed).toMatchObject({ kind: 'valid', request: { birthDate: '2015-05-05' } });
    if (parsed.kind === 'valid') expect(parsed.request.acceptTerms).toBeUndefined();
  });

  it('sin una fecha válida no hay petición: errores de la fecha y de la casilla', () => {
    const parsed = parseDataReviewForm(form({ ...base, day: '31', month: '2' }), TODAY);
    expect(parsed).toMatchObject({
      kind: 'invalid',
      errors: {
        fields: {
          birthDate: 'registro.error.fecha_inexistente',
          acceptTerms: 'registro.error.condiciones',
        },
      },
    });
    const future = parseDataReviewForm(form({ ...base, year: '2027', acceptTerms: 'on' }), TODAY);
    expect(future).toMatchObject({
      kind: 'invalid',
      errors: { fields: { birthDate: 'registro.error.fecha_futura' } },
    });
  });
});
