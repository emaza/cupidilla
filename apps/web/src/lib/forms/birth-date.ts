import { birthDateSchema } from '@cupidilla/contracts';

export type DatePart = 'dia' | 'mes' | 'anio';

export type BirthDateProblem = 'empty' | 'day' | 'month' | 'year' | 'nonexistent';

export type BirthDateParts =
  { ok: true; date: string } | { ok: false; problem: BirthDateProblem; invalidParts: DatePart[] };

const PART_PROBLEM: Record<DatePart, BirthDateProblem> = {
  dia: 'day',
  mes: 'month',
  anio: 'year',
};

function isIntegerBetween(value: string, pattern: RegExp, min: number, max: number): boolean {
  if (!pattern.test(value)) return false;
  const number = Number(value);
  return number >= min && number <= max;
}

/**
 * Valida por partes la fecha de los tres campos de texto (UX §3.2) y compone 'YYYY-MM-DD'.
 * Se recortan espacios; el día y el mes admiten una o dos cifras y el año, cuatro (desde 1900).
 * Si fallan varias partes, el problema es el de la primera; si están las tres vacías, `empty`.
 */
export function parseBirthDateParts(day: string, month: string, year: string): BirthDateParts {
  const parts: Record<DatePart, string> = { dia: day.trim(), mes: month.trim(), anio: year.trim() };

  if (parts.dia === '' && parts.mes === '' && parts.anio === '') {
    return { ok: false, problem: 'empty', invalidParts: ['dia', 'mes', 'anio'] };
  }

  const valid: Record<DatePart, boolean> = {
    dia: isIntegerBetween(parts.dia, /^\d{1,2}$/, 1, 31),
    mes: isIntegerBetween(parts.mes, /^\d{1,2}$/, 1, 12),
    anio: isIntegerBetween(parts.anio, /^\d{4}$/, 1900, 9999),
  };
  const invalidParts = (['dia', 'mes', 'anio'] as const).filter((part) => !valid[part]);
  const [first] = invalidParts;
  if (first) {
    return { ok: false, problem: PART_PROBLEM[first], invalidParts };
  }

  const date = `${parts.anio}-${parts.mes.padStart(2, '0')}-${parts.dia.padStart(2, '0')}`;
  if (!birthDateSchema.safeParse(date).success) {
    return { ok: false, problem: 'nonexistent', invalidParts: ['dia', 'mes', 'anio'] };
  }
  return { ok: true, date };
}
