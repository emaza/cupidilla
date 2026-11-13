import { describe, expect, it } from 'vitest';
import { envSchema } from './env.schema.js';

const base = { INTERNAL_API_KEY: 'k'.repeat(32) };
const db = 'postgres://u:secreto@127.0.0.1:5432/cupidilla';

describe('DATABASE_URL no puede anular los límites de tiempo (§7.2)', () => {
  it.each([
    'statement_timeout=0',
    'query_timeout=0',
    'idle_in_transaction_session_timeout=0',
    'connectionTimeoutMillis=0',
    'connect_timeout=0',
    'options=-c%20statement_timeout%3D0',
    'STATEMENT_TIMEOUT=0',
    'sslmode=require&Statement_Timeout=0',
  ])('rechaza ?%s, con un mensaje claro y sin mostrar la URL', (query) => {
    const result = envSchema.safeParse({ ...base, DATABASE_URL: `${db}?${query}` });
    expect(result.success).toBe(false);
    const messages = result.success ? [] : result.error.issues.map((issue) => issue.message);
    expect(messages.join(' ')).toMatch(/DATABASE_URL no puede llevar .*DB_\*_MS/);
    expect(messages.join(' ')).not.toContain('secreto');
  });

  it.each(['', '?sslmode=require', '?application_name=cupidilla&sslmode=verify-full'])(
    'acepta la URL sin esos parámetros (%s)',
    (query) => {
      expect(envSchema.safeParse({ ...base, DATABASE_URL: `${db}${query}` }).success).toBe(true);
    },
  );
});
