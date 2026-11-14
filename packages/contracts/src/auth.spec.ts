import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  birthDateSchema,
  emailSchema,
  formatSpanishDate,
  loginRequestSchema,
  newPasswordSchema,
  passwordInputSchema,
  registerRequestSchema,
} from './auth.js';

function issues(schema: z.ZodType, input: unknown): string[] {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('emailSchema (C-5)', () => {
  it('recorta y pasa a minúsculas', () => {
    expect(emailSchema.parse('  Ana.Lopez@Example.COM ')).toBe('ana.lopez@example.com');
  });

  it('rechaza lo que no es un correo', () => {
    expect(issues(emailSchema, 'no-es-correo')).toEqual(['invalid_format']);
    expect(issues(emailSchema, undefined)).toEqual(['required']);
    expect(issues(emailSchema, '')).toEqual(['required']);
    expect(issues(emailSchema, '   ')).toEqual(['required']);
    expect(issues(emailSchema, `${'a'.repeat(250)}@example.com`)).toEqual(['too_long']);
  });
});

describe('newPasswordSchema (C-5)', () => {
  it('cuenta de 10 a 128 puntos de código', () => {
    expect(issues(newPasswordSchema, '')).toEqual(['required']);
    expect(issues(newPasswordSchema, 'a'.repeat(9))).toEqual(['too_short']);
    expect(issues(newPasswordSchema, 'a'.repeat(10))).toEqual([]);
    expect(issues(newPasswordSchema, 'a'.repeat(128))).toEqual([]);
    expect(issues(newPasswordSchema, 'a'.repeat(129))).toEqual(['too_long']);
  });

  it('cuenta un emoji compuesto por sus puntos de código', () => {
    const technologist = '👩‍💻'; // 3 puntos de código, 5 unidades UTF-16
    expect([...technologist].length).toBe(3);
    // 3 emojis = 9 puntos de código (15 unidades UTF-16): demasiado corta.
    expect(issues(newPasswordSchema, technologist.repeat(3))).toEqual(['too_short']);
    // 3 emojis + 1 letra = 10 puntos de código.
    expect(issues(newPasswordSchema, `${technologist.repeat(3)}a`)).toEqual([]);
    // 128 emojis de un punto de código (256 unidades UTF-16) caben.
    expect(issues(newPasswordSchema, '😀'.repeat(128))).toEqual([]);
  });

  it('no recorta espacios', () => {
    expect(newPasswordSchema.parse('  diez car ')).toBe('  diez car ');
  });
});

describe('passwordInputSchema', () => {
  it('exige al menos un carácter y como mucho 128', () => {
    expect(issues(passwordInputSchema, '')).toEqual(['required']);
    expect(issues(passwordInputSchema, 'corta')).toEqual([]);
    expect(issues(passwordInputSchema, 'a'.repeat(129))).toEqual(['too_long']);
  });
});

describe('longitud de la contraseña tras NFKC (§8.1)', () => {
  const composed = '\u00e9'; // «é» en un punto de código
  const decomposed = 'e\u0301'; // «e» + acento combinante: dos puntos de código

  it('«é» compuesta y descompuesta ×128 dan el mismo resultado en los dos esquemas', () => {
    for (const schema of [newPasswordSchema, passwordInputSchema]) {
      expect(issues(schema, composed.repeat(128))).toEqual([]);
      expect(issues(schema, decomposed.repeat(128))).toEqual([]);
      expect(issues(schema, composed.repeat(129))).toEqual(['too_long']);
      expect(issues(schema, decomposed.repeat(129))).toEqual(['too_long']);
    }
  });

  it('no cambia el valor validado', () => {
    expect(newPasswordSchema.parse(decomposed.repeat(10))).toBe(decomposed.repeat(10));
    expect(passwordInputSchema.parse(decomposed)).toBe(decomposed);
  });
});

describe('birthDateSchema (C-6)', () => {
  it('rechaza fechas imposibles y anteriores a 1900', () => {
    expect(issues(birthDateSchema, '2007-02-29')).toEqual(['invalid_format']);
    expect(issues(birthDateSchema, '2026-02-30')).toEqual(['invalid_format']);
    expect(issues(birthDateSchema, '05/05/1990')).toEqual(['invalid_format']);
    expect(issues(birthDateSchema, '')).toEqual(['invalid_format']);
    expect(issues(birthDateSchema, '1899-12-31')).toEqual(['too_old']);
  });

  it('acepta bisiestos reales y el límite de 1900', () => {
    expect(issues(birthDateSchema, '2000-02-29')).toEqual([]);
    expect(issues(birthDateSchema, '1900-01-01')).toEqual([]);
  });

  it('da required si falta', () => {
    expect(issues(birthDateSchema, undefined)).toEqual(['required']);
  });
});

describe('registerRequestSchema y loginRequestSchema', () => {
  const valid = {
    email: ' Ana@Example.com',
    password: 'contraseña-larga',
    birthDate: '1990-05-05',
    acceptTerms: true,
    termsVersion: '2026-11-borrador',
  };

  it('acepta un registro válido y normaliza el correo', () => {
    expect(registerRequestSchema.parse(valid).email).toBe('ana@example.com');
  });

  it('exige aceptar las condiciones', () => {
    expect(issues(registerRequestSchema, { ...valid, acceptTerms: false })).toEqual(['required']);
    const withoutTerms: Record<string, unknown> = { ...valid };
    delete withoutTerms.acceptTerms;
    expect(issues(registerRequestSchema, withoutTerms)).toEqual(['required']);
  });

  it('rechaza campos desconocidos', () => {
    expect(issues(registerRequestSchema, { ...valid, name: 'Ana' })).toEqual(['unrecognized']);
    expect(issues(loginRequestSchema, { email: 'a@b.es', password: 'x', extra: 1 })).toEqual([
      'unrecognized',
    ]);
  });
});

describe('formatSpanishDate', () => {
  it('escribe el día del instante en Europe/Madrid', () => {
    expect(formatSpanishDate('2026-11-18T10:00:00Z')).toBe('18 de noviembre de 2026');
    // A las 23:30 UTC ya es día 19 en Madrid.
    expect(formatSpanishDate(new Date('2026-11-18T23:30:00Z'))).toBe('19 de noviembre de 2026');
  });
});
