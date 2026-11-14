import { describe, expect, it } from 'vitest';
import { envSchema } from './env.schema.js';

const base = {
  DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/cupidilla_test',
  INTERNAL_API_KEY: 'k'.repeat(32),
  // Obligatorias desde el hito de correo (§8.1).
  PUBLIC_WEB_URL: 'http://localhost:5173',
  SMTP_URL: 'smtp://127.0.0.1:1025',
};

describe('QA: límites de tiempo de PostgreSQL en envSchema (§7.2)', () => {
  it('sin variables, valen 3000, 4000 y 10000 ms; statement_timeout < 5 s de la web', () => {
    const env = envSchema.parse(base);
    expect(env.DB_CONNECTION_TIMEOUT_MS).toBe(3000);
    expect(env.DB_STATEMENT_TIMEOUT_MS).toBe(4000);
    expect(env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS).toBe(10_000);
    expect(env.DB_STATEMENT_TIMEOUT_MS).toBeLessThan(5000);
  });

  it('acepta 4000 como máximo de conexión y de sentencia: con query_timeout, menos de 5 s', () => {
    const env = envSchema.parse({
      ...base,
      DB_CONNECTION_TIMEOUT_MS: '4000',
      DB_STATEMENT_TIMEOUT_MS: '4000',
    });
    expect(env.DB_CONNECTION_TIMEOUT_MS).toBe(4000);
    expect(env.DB_STATEMENT_TIMEOUT_MS + 500).toBeLessThan(5000);
  });

  it('acepta números en texto, como llegan del entorno', () => {
    const env = envSchema.parse({ ...base, DB_STATEMENT_TIMEOUT_MS: '2500' });
    expect(env.DB_STATEMENT_TIMEOUT_MS).toBe(2500);
  });

  it.each(['0', '-1', '1.5', 'abc', '', '4001'])(
    'rechaza DB_STATEMENT_TIMEOUT_MS=%j: la API no arranca con un límite no válido (0 significaría «sin límite» en pg)',
    (value) => {
      const result = envSchema.safeParse({ ...base, DB_STATEMENT_TIMEOUT_MS: value });
      expect(result.success).toBe(false);
    },
  );

  it.each([
    ['DB_CONNECTION_TIMEOUT_MS', '4001'],
    ['DB_IDLE_IN_TRANSACTION_TIMEOUT_MS', '600001'],
    ['DB_CONNECTION_TIMEOUT_MS', '0'],
    ['DB_IDLE_IN_TRANSACTION_TIMEOUT_MS', '0'],
  ])('rechaza %s=%s', (name, value) => {
    expect(envSchema.safeParse({ ...base, [name]: value }).success).toBe(false);
  });
});
