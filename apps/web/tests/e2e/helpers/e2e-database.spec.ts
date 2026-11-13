import { afterEach, describe, expect, it, vi } from 'vitest';
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

  describe('sin argumento, lee E2E_DATABASE_URL', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('si la variable no está definida, se niega', () => {
      vi.stubEnv('E2E_DATABASE_URL', undefined);
      expect(() => e2eDatabaseUrl()).toThrow(/\*_e2e/);
    });

    it('si apunta a una base *_e2e, la devuelve', () => {
      vi.stubEnv('E2E_DATABASE_URL', 'postgres://u:p@127.0.0.1:5432/cupidilla_e2e');
      expect(e2eDatabaseUrl()).toBe('postgres://u:p@127.0.0.1:5432/cupidilla_e2e');
    });
  });
});
