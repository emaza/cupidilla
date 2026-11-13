import { describe, expect, it } from 'vitest';
import { parseBirthDateParts } from './birth-date.ts';

describe('W-2: parseBirthDateParts', () => {
  it.each(['5', '05', '5 '])('acepta «%s» como día y como mes', (value) => {
    expect(parseBirthDateParts(value, value, '1990')).toEqual({ ok: true, date: '1990-05-05' });
  });

  it('31/2/2000 es una fecha inexistente y marca las tres partes', () => {
    expect(parseBirthDateParts('31', '2', '2000')).toEqual({
      ok: false,
      problem: 'nonexistent',
      invalidParts: ['day', 'month', 'year'],
    });
  });

  it('0/5/1990 da error de día', () => {
    expect(parseBirthDateParts('0', '5', '1990')).toEqual({
      ok: false,
      problem: 'day',
      invalidParts: ['day'],
    });
  });

  it('12/13/1990 da error de mes', () => {
    expect(parseBirthDateParts('12', '13', '1990')).toEqual({
      ok: false,
      problem: 'month',
      invalidParts: ['month'],
    });
  });

  it('un año de tres cifras, o anterior a 1900, da error de año', () => {
    expect(parseBirthDateParts('1', '1', '990')).toMatchObject({ ok: false, problem: 'year' });
    expect(parseBirthDateParts('1', '1', '1899')).toMatchObject({ ok: false, problem: 'year' });
  });

  it('los tres vacíos dan fecha vacía', () => {
    expect(parseBirthDateParts('', ' ', '')).toEqual({
      ok: false,
      problem: 'empty',
      invalidParts: ['day', 'month', 'year'],
    });
  });

  it('si fallan varias partes, el problema es el de la primera y se marcan todas las que fallan', () => {
    expect(parseBirthDateParts('', 'x', '1990')).toEqual({
      ok: false,
      problem: 'day',
      invalidParts: ['day', 'month'],
    });
  });

  it('acepta el 29 de febrero de un año bisiesto', () => {
    expect(parseBirthDateParts('29', '2', '2000')).toEqual({ ok: true, date: '2000-02-29' });
  });
});
