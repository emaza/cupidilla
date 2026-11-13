export const MIN_AGE = 18;
export const REFERENCE_TIME_ZONE = 'Europe/Madrid';
export const MIN_BIRTH_DATE = '1900-01-01';

interface CivilDate {
  year: number;
  month: number;
  day: number;
}

function parseCivilDate(value: string): CivilDate {
  const [year, month, day] = value.split('-').map(Number);
  return { year: year ?? NaN, month: month ?? NaN, day: day ?? NaN };
}

function formatCivilDate({ year, month, day }: CivilDate): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Fecha civil 'YYYY-MM-DD' de un instante en una zona horaria (Intl.DateTimeFormat#formatToParts). */
export function calendarDateIn(timeZone: string, instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  return formatCivilDate({ year: part('year'), month: part('month'), day: part('day') });
}

/** «Hoy» de referencia para la regla de edad. */
export function referenceToday(instant: Date): string {
  return calendarDateIn(REFERENCE_TIME_ZONE, instant);
}

/**
 * Años cumplidos en `today`. Ambas fechas 'YYYY-MM-DD' ya validadas.
 * Quien nació un 29 de febrero cumple años el 28 de febrero en los años no bisiestos
 * (artículo 5.1 del Código Civil).
 */
export function ageOn(birthDate: string, today: string): number {
  const birth = parseCivilDate(birthDate);
  const now = parseCivilDate(today);
  const effectiveDay =
    birth.month === 2 && birth.day === 29 && !isLeapYear(now.year) ? 28 : birth.day;
  const beforeBirthday =
    now.month < birth.month || (now.month === birth.month && now.day < effectiveDay);
  return now.year - birth.year - (beforeBirthday ? 1 : 0);
}

export function isAdultOn(birthDate: string, today: string): boolean {
  return ageOn(birthDate, today) >= MIN_AGE;
}

export type BirthDateCheck = { ok: true } | { ok: false; reason: 'IN_FUTURE' | 'UNDERAGE' };

/** Comprueba una fecha ya validada con `birthDateSchema`. La fecha futura se detecta antes que la edad. */
export function checkBirthDate(birthDate: string, today: string): BirthDateCheck {
  if (birthDate > today) return { ok: false, reason: 'IN_FUTURE' };
  if (!isAdultOn(birthDate, today)) return { ok: false, reason: 'UNDERAGE' };
  return { ok: true };
}

/** Fecha de nacimiento más reciente que es mayor de edad en `today` (útil para la interfaz y los tests). */
export function latestAdultBirthDate(today: string): string {
  const now = parseCivilDate(today);
  const year = now.year - MIN_AGE;
  if (now.month === 2 && now.day === 29 && !isLeapYear(year)) {
    return formatCivilDate({ year, month: 2, day: 28 });
  }
  if (now.month === 2 && now.day === 28 && !isLeapYear(now.year) && isLeapYear(year)) {
    // Quien nació el 29 de febrero cumple hoy, 28 de febrero de un año no bisiesto.
    return formatCivilDate({ year, month: 2, day: 29 });
  }
  return formatCivilDate({ year, month: now.month, day: now.day });
}
