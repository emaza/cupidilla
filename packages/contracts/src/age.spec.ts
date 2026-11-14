import { describe, expect, it } from 'vitest';
import {
  ageOn,
  checkBirthDate,
  DEFAULT_MIN_AGE,
  isAdultOn,
  latestAdultBirthDate,
  MIN_AGE_RANGE,
  referenceToday,
} from './age.js';
import { configResponseSchema } from './config.js';

/** Suma días a una fecha 'YYYY-MM-DD' usando UTC, solo para los tests. */
function addDays(date: string, days: number): string {
  const instant = new Date(`${date}T00:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

describe('ageOn / isAdultOn (C-1)', () => {
  it('es mayor de edad el día que cumple 18 y no el día antes', () => {
    expect(isAdultOn('2008-11-11', '2026-11-11', 18)).toBe(true);
    expect(isAdultOn('2008-11-12', '2026-11-11', 18)).toBe(false);
  });

  it('quien nace el 29 de febrero cumple el 28 en los años no bisiestos', () => {
    expect(isAdultOn('2008-02-29', '2026-02-28', 18)).toBe(true);
    expect(isAdultOn('2008-02-29', '2026-02-27', 18)).toBe(false);
    expect(ageOn('2008-02-29', '2028-02-28')).toBe(19);
    expect(ageOn('2008-02-29', '2028-02-29')).toBe(20);
  });
});

describe('latestAdultBirthDate (C-2)', () => {
  it('es mayor de edad y el día siguiente ya no, para cada día de 2024 a 2030', () => {
    for (let day = '2024-01-01'; day <= '2030-12-31'; day = addDays(day, 1)) {
      const latest = latestAdultBirthDate(day, 18);
      expect(isAdultOn(latest, day, 18), `${latest} en ${day}`).toBe(true);
      expect(isAdultOn(addDays(latest, 1), day, 18), `${addDays(latest, 1)} en ${day}`).toBe(false);
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
    expect(checkBirthDate('2026-11-12', '2026-11-11', 18)).toEqual({
      ok: false,
      reason: 'IN_FUTURE',
    });
    expect(checkBirthDate('2010-01-01', '2026-11-11', 18)).toEqual({
      ok: false,
      reason: 'UNDERAGE',
    });
    expect(checkBirthDate('2026-11-11', '2026-11-11', 18)).toEqual({
      ok: false,
      reason: 'UNDERAGE',
    });
    expect(checkBirthDate('1990-05-05', '2026-11-11', 18)).toEqual({ ok: true });
  });
});

describe('edad mínima distinta de 18', () => {
  it('el rango por defecto es 18 y permite de 18 a 25', () => {
    expect(DEFAULT_MIN_AGE).toBe(18);
    expect(MIN_AGE_RANGE).toEqual({ min: 18, max: 25 });
  });

  it('con 21: a los 20 años no, el día que cumple 21 sí', () => {
    expect(isAdultOn('2005-11-12', '2026-11-11', 21)).toBe(false);
    expect(isAdultOn('2005-11-11', '2026-11-11', 21)).toBe(true);
    expect(isAdultOn('2008-11-11', '2026-11-11', 21)).toBe(false);
  });

  it('con 21: checkBirthDate separa menor, mayor y fecha futura', () => {
    expect(checkBirthDate('2005-11-12', '2026-11-11', 21)).toEqual({
      ok: false,
      reason: 'UNDERAGE',
    });
    expect(checkBirthDate('2005-11-11', '2026-11-11', 21)).toEqual({ ok: true });
    expect(checkBirthDate('2026-11-12', '2026-11-11', 21)).toEqual({
      ok: false,
      reason: 'IN_FUTURE',
    });
  });

  it.each([18, 21, 25])(
    'latestAdultBirthDate(%i): es mayor y el día siguiente no, cada día de 2024 a 2030',
    (minAge) => {
      for (let day = '2024-01-01'; day <= '2030-12-31'; day = addDays(day, 1)) {
        const latest = latestAdultBirthDate(day, minAge);
        expect(isAdultOn(latest, day, minAge), `${latest} en ${day}`).toBe(true);
        expect(isAdultOn(addDays(latest, 1), day, minAge), `${latest}+1 en ${day}`).toBe(false);
      }
    },
  );

  it('29 de febrero con 21 años (2004 es bisiesto; 2025 no)', () => {
    // Nacida el 29-02-2004: cumple 21 el 28-02-2025 (año no bisiesto).
    expect(isAdultOn('2004-02-29', '2025-02-27', 21)).toBe(false);
    expect(isAdultOn('2004-02-29', '2025-02-28', 21)).toBe(true);
    expect(latestAdultBirthDate('2025-02-28', 21)).toBe('2004-02-29');
    // Hoy es 29-02-2028 (bisiesto) y 21 años atrás, 2007, no lo es: último válido, 28-02-2007.
    expect(latestAdultBirthDate('2028-02-29', 21)).toBe('2007-02-28');
    expect(isAdultOn('2007-02-28', '2028-02-29', 21)).toBe(true);
    expect(isAdultOn('2007-03-01', '2028-02-29', 21)).toBe(false);
  });

  it('29 de febrero con 25 años: el 29-02-2000 cumple 25 el 28-02-2025', () => {
    expect(isAdultOn('2000-02-29', '2025-02-27', 25)).toBe(false);
    expect(isAdultOn('2000-02-29', '2025-02-28', 25)).toBe(true);
    expect(latestAdultBirthDate('2025-02-28', 25)).toBe('2000-02-29');
  });
});

describe('configResponseSchema', () => {
  const mail = { unverifiedReminder: true, passwordChangedNotice: false };

  it('acepta la edad dentro del rango y rechaza lo demás', () => {
    expect(configResponseSchema.parse({ minAge: 21, mail })).toEqual({ minAge: 21, mail });
    for (const minAge of [17, 26, 21.5, '21', undefined]) {
      expect(configResponseSchema.safeParse({ minAge, mail }).success).toBe(false);
    }
  });

  it('exige la configuración de los correos opcionales (correo §5.8)', () => {
    expect(configResponseSchema.safeParse({ minAge: 18 }).success).toBe(false);
    expect(
      configResponseSchema.safeParse({ minAge: 18, mail: { unverifiedReminder: 'true' } }).success,
    ).toBe(false);
  });
});
