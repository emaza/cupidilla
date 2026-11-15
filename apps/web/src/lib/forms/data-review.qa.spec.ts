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

/** QA fase C, desviación 2: acceptTerms: true solo viaja con una fecha de menor. */
describe('parseDataReviewForm: consentimiento', () => {
  it('adulto con la casilla desmarcada o con valor raro: invalid, nunca una petición', () => {
    for (const acceptTerms of [undefined, '', 'off', 'true', '1']) {
      const fields: Record<string, string> = { ...base };
      if (acceptTerms !== undefined) fields.acceptTerms = acceptTerms;
      const parsed = parseDataReviewForm(form(fields), TODAY, 18);
      expect(parsed.kind, String(acceptTerms)).toBe('invalid');
    }
  });

  it('adulto con la casilla marcada: valid con acceptTerms true', () => {
    const parsed = parseDataReviewForm(form({ ...base, acceptTerms: 'on' }), TODAY, 18);
    expect(parsed).toMatchObject({ kind: 'valid', request: { acceptTerms: true } });
  });

  it('menor con la casilla desmarcada: underage (la API borra antes de mirar la casilla)', () => {
    const parsed = parseDataReviewForm(form({ ...base, year: '2015' }), TODAY, 18);
    expect(parsed.kind).toBe('underage');
  });

  it('con MIN_AGE 21 un 19 años es menor; con 18, adulto sin casilla es invalid', () => {
    const nineteen = { ...base, year: '2007' };
    expect(parseDataReviewForm(form(nineteen), TODAY, 21).kind).toBe('underage');
    expect(parseDataReviewForm(form(nineteen), TODAY, 18).kind).toBe('invalid');
  });
});
