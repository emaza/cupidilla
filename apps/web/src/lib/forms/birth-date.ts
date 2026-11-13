import { birthDateSchema } from '@cupidilla/contracts';

export type DatePart = 'day' | 'month' | 'year';

export type BirthDateProblem = 'empty' | 'day' | 'month' | 'year' | 'nonexistent';

export type BirthDateParts =
  { ok: true; date: string } | { ok: false; problem: BirthDateProblem; invalidParts: DatePart[] };

const PART_PROBLEM: Record<DatePart, BirthDateProblem> = {
  day: 'day',
  month: 'month',
  year: 'year',
};

function isIntegerBetween(value: string, pattern: RegExp, min: number, max: number): boolean {
  if (!pattern.test(value)) return false;
  const number = Number(value);
  return number >= min && number <= max;
}

/**
 * Valida por partes la fecha de los tres campos de texto (UX §3.2) y compone 'YYYY-MM-DD'.
 * Se recortan espacios; el día y el month admiten una o dos cifras y el año, cuatro (desde 1900).
 * Si fallan varias partes, el problema es el de la primera; si están las tres vacías, `empty`.
 */
export function parseBirthDateParts(day: string, month: string, year: string): BirthDateParts {
  const parts: Record<DatePart, string> = {
    day: day.trim(),
    month: month.trim(),
    year: year.trim(),
  };

  if (parts.day === '' && parts.month === '' && parts.year === '') {
    return { ok: false, problem: 'empty', invalidParts: ['day', 'month', 'year'] };
  }

  const valid: Record<DatePart, boolean> = {
    day: isIntegerBetween(parts.day, /^\d{1,2}$/, 1, 31),
    month: isIntegerBetween(parts.month, /^\d{1,2}$/, 1, 12),
    year: isIntegerBetween(parts.year, /^\d{4}$/, 1900, 9999),
  };
  const invalidParts = (['day', 'month', 'year'] as const).filter((part) => !valid[part]);
  const [first] = invalidParts;
  if (first) {
    return { ok: false, problem: PART_PROBLEM[first], invalidParts };
  }

  const date = `${parts.year}-${parts.month.padStart(2, '0')}-${parts.day.padStart(2, '0')}`;
  if (!birthDateSchema.safeParse(date).success) {
    return { ok: false, problem: 'nonexistent', invalidParts: ['day', 'month', 'year'] };
  }
  return { ok: true, date };
}
