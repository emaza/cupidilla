import { describe, expect, it } from 'vitest';
import { envSchema } from './env.schema.js';

const base = {
  DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/cupidilla_test',
  INTERNAL_API_KEY: 'k'.repeat(32),
  // Obligatorias desde el hito de correo (§8.1).
  PUBLIC_WEB_URL: 'http://localhost:5173',
  SMTP_URL: 'smtp://127.0.0.1:1025',
};

describe('MIN_AGE en envSchema', () => {
  it('sin definir vale 18', () => {
    expect(envSchema.parse(base).MIN_AGE).toBe(18);
  });

  it.each([
    ['18', 18],
    ['21', 21],
    ['25', 25],
  ])('acepta MIN_AGE=%s', (value, expected) => {
    expect(envSchema.parse({ ...base, MIN_AGE: value }).MIN_AGE).toBe(expected);
  });

  it.each(['17', '26', 'abc', '21.5', '-1', '', '0'])(
    'rechaza MIN_AGE=%j y el error nombra MIN_AGE',
    (value) => {
      const result = envSchema.safeParse({ ...base, MIN_AGE: value });
      expect(result.success).toBe(false);
      const paths = result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('MIN_AGE');
    },
  );
});

describe('los mensajes de MIN_AGE nombran la variable', () => {
  it.each(['17', '26', 'abc', '21.5'])('MIN_AGE=%s', (value) => {
    const result = envSchema.safeParse({ ...base, MIN_AGE: value });
    const messages = result.success ? [] : result.error.issues.map((issue) => issue.message);
    expect(messages.join(' ')).toContain('MIN_AGE');
  });
});
