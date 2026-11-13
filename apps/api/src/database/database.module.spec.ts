import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPool } from './database.module.js';

const settings = {
  DATABASE_URL: 'postgres://usuario:secreto-de-prueba@127.0.0.1:1/cupidilla_test',
  DB_CONNECTION_TIMEOUT_MS: 3000,
  DB_STATEMENT_TIMEOUT_MS: 4000,
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: 10_000,
};

describe('createPool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('un error de un cliente inactivo no tumba el proceso y se registra saneado', async () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const pool = createPool(settings);
    const error = Object.assign(new Error(`terminating connection; ${settings.DATABASE_URL}`), {
      code: '57P01',
    });

    expect(() => pool.emit('error', error)).not.toThrow();
    expect(logged).toHaveBeenCalledWith({ event: 'pg_pool_error', code: '57P01' });
    expect(JSON.stringify(logged.mock.calls)).not.toContain('secreto-de-prueba');

    // Sin `code` (p. ej. un error de red) también se registra, con `code: null`.
    pool.emit('error', new Error('read ECONNRESET'));
    expect(logged).toHaveBeenLastCalledWith({ event: 'pg_pool_error', code: null });
    await pool.end();
  });

  it('pasa los límites de tiempo al pool y al servidor', async () => {
    const pool = createPool(settings);
    expect(pool.options).toMatchObject({
      connectionTimeoutMillis: 3000,
      statement_timeout: 4000,
      // Límite del cliente, derivado: statement_timeout + 500 ms (BUG-QA-8).
      query_timeout: 4500,
      idle_in_transaction_session_timeout: 10_000,
    });
    await pool.end();
  });
});

describe('createPool: errores de adquisición', () => {
  it('un 57P01 al conectar (en connect() o en un query suelto) no es «resultado incierto»', async () => {
    const { isConnectionLost } = await import('./pg-errors.js');
    const pool = createPool(settings); // puerto 1: la conexión se rechaza
    const fromConnect = await pool.connect().catch((error: unknown) => error);
    const fromQuery = await pool.query('select 1').catch((error: unknown) => error);
    for (const error of [fromConnect, fromQuery]) {
      expect(error).toBeInstanceOf(Error);
      // Aunque llevara un código de sesión terminada, viene de la adquisición: no se envió nada.
      Object.assign(error as Error, { code: '57P01' });
      expect(isConnectionLost(error)).toBe(false);
    }
    await pool.end();
  });
});
