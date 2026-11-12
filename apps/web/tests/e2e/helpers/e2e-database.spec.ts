import { describe, expect, it } from 'vitest';
import { e2eDatabaseUrl } from './e2e-database.ts';

describe('e2eDatabaseUrl', () => {
  it('acepta una base *_e2e, también con parámetros de conexión', () => {
    for (const url of [
      'postgres://u:p@127.0.0.1:5432/cupidilla_e2e',
      'postgres://u:p@db.example.com/cupidilla_e2e?sslmode=require',
      'postgresql://db.example.com:6543/otra_e2e?application_name=e2e&sslmode=verify-full',
    ]) {
      expect(e2eDatabaseUrl(url)).toBe(url);
    }
  });

  it('rechaza cualquier otra base, aunque la URL acabe en _e2e', () => {
    for (const url of [
      undefined,
      '',
      'no es una url',
      'postgres://u:p@127.0.0.1:5432/cupidilla',
      'postgres://u:p@127.0.0.1:5432/cupidilla_test',
      'postgres://u:p@127.0.0.1:5432/cupidilla?application_name=x_e2e',
      'postgres://u:p@127.0.0.1:5432/cupidilla#_e2e',
    ]) {
      expect(() => e2eDatabaseUrl(url), String(url)).toThrow(/\*_e2e/);
    }
  });
});
