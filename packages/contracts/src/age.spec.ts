import { describe, expect, it } from 'vitest';
import { ageOn, checkBirthDate, isAdultOn, latestAdultBirthDate, referenceToday } from './age.js';

/** Suma días a una fecha 'YYYY-MM-DD' usando UTC, solo para los tests. */
function addDays(date: string, days: number): string {
  const instant = new Date(`${date}T00:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

describe('ageOn / isAdultOn (C-1)', () => {
  it('es mayor de edad el día que cumple 18 y no el día antes', () => {
    expect(isAdultOn('2008-11-11', '2026-11-11')).toBe(true);
    expect(isAdultOn('2008-11-12', '2026-11-11')).toBe(false);
  });

  it('quien nace el 29 de febrero cumple el 28 en los años no bisiestos', () => {
    expect(isAdultOn('2008-02-29', '2026-02-28')).toBe(true);
    expect(isAdultOn('2008-02-29', '2026-02-27')).toBe(false);
    expect(ageOn('2008-02-29', '2028-02-28')).toBe(19);
    expect(ageOn('2008-02-29', '2028-02-29')).toBe(20);
  });
});

describe('latestAdultBirthDate (C-2)', () => {
  it('es mayor de edad y el día siguiente ya no, para cada día de 2024 a 2030', () => {
    for (let day = '2024-01-01'; day <= '2030-12-31'; day = addDays(day, 1)) {
      const latest = latestAdultBirthDate(day);
      expect(isAdultOn(latest, day), `${latest} en ${day}`).toBe(true);
      expect(isAdultOn(addDays(latest, 1), day), `${addDays(latest, 1)} en ${day}`).toBe(false);
    }
  });
});

describe('referenceToday (C-3)', () => {
  it('usa la fecha civil de Madrid', () => {
    expect(referenceToday(new Date('2026-11-10T23:30:00Z'))).toBe('2026-11-11');
    expect(referenceToday(new Date('2026-11-10T22:30:00Z'))).toBe('2026-11-10');
    expect(referenceToday(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
  });

  it('respeta los cambios de hora de 2026', () => {
    // 29 de marzo de 2026: Madrid pasa a UTC+2 a la 01:00 UTC.
    expect(referenceToday(new Date('2026-03-28T22:59:00Z'))).toBe('2026-03-28');
    expect(referenceToday(new Date('2026-03-28T23:00:00Z'))).toBe('2026-03-29');
    expect(referenceToday(new Date('2026-03-29T21:59:00Z'))).toBe('2026-03-29');
    expect(referenceToday(new Date('2026-03-29T22:00:00Z'))).toBe('2026-03-30');
    // 25 de octubre de 2026: Madrid vuelve a UTC+1 a la 01:00 UTC.
    expect(referenceToday(new Date('2026-10-24T21:59:00Z'))).toBe('2026-10-24');
    expect(referenceToday(new Date('2026-10-24T22:00:00Z'))).toBe('2026-10-25');
    expect(referenceToday(new Date('2026-10-25T22:59:00Z'))).toBe('2026-10-25');
    expect(referenceToday(new Date('2026-10-25T23:00:00Z'))).toBe('2026-10-26');
  });
});

describe('checkBirthDate (C-4)', () => {
  it('detecta la fecha futura antes que la minoría de edad', () => {
    expect(checkBirthDate('2026-11-12', '2026-11-11')).toEqual({ ok: false, reason: 'IN_FUTURE' });
    expect(checkBirthDate('2010-01-01', '2026-11-11')).toEqual({ ok: false, reason: 'UNDERAGE' });
    expect(checkBirthDate('2026-11-11', '2026-11-11')).toEqual({ ok: false, reason: 'UNDERAGE' });
    expect(checkBirthDate('1990-05-05', '2026-11-11')).toEqual({ ok: true });
  });
});
