import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool } from '../src/database/database.module.js';
import { Transactions } from '../src/database/transactions.js';

/**
 * QA, cuarta revisión. [BUG-QA-9]: un cliente PRESTADO por `Transactions.run` no tiene listener
 * de `error` (el del pool solo vale para clientes libres). Si PostgreSQL cierra la sesión entre
 * dos sentencias de la transacción (reinicio, failover, `pg_terminate_backend`,
 * `idle_in_transaction_session_timeout`), `pg` emite `error` en el cliente sin nadie escuchando y
 * Node lanza una excepción no capturada: en la API real, el proceso muere.
 */
const url = process.env.DATABASE_URL ?? '';
const settings = (DB_IDLE_IN_TRANSACTION_TIMEOUT_MS = 10_000) => ({
  DATABASE_URL: url,
  DB_CONNECTION_TIMEOUT_MS: 1000,
  DB_STATEMENT_TIMEOUT_MS: 1000,
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
});
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe('[BUG-QA-9] el servidor cierra la sesión entre dos sentencias de una transacción', () => {
  let pool: pg.Pool;
  let admin: pg.Pool;
  let transactions: Transactions;
  const uncaught: Error[] = [];
  const onUncaught = (error: Error) => uncaught.push(error);
  let saved: NodeJS.UncaughtExceptionListener[] = [];

  beforeAll(() => {
    pool = createPool(settings());
    admin = createPool(settings());
    transactions = new Transactions(pool);
  });
  afterAll(async () => {
    await pool.end();
    await admin.end();
  });
  beforeEach(() => {
    // Se capturan aquí las excepciones no capturadas (vitest las daría por fallo de toda la
    // ejecución, y el fallo ya lo da la aserción de este test).
    uncaught.length = 0;
    saved = process.listeners('uncaughtException');
    process.removeAllListeners('uncaughtException');
    process.on('uncaughtException', onUncaught);
  });
  afterEach(() => {
    process.off('uncaughtException', onUncaught);
    for (const listener of saved) process.on('uncaughtException', listener);
  });

  it('pg_terminate_backend entre dos sentencias: no hay excepción no capturada y el pool sigue sano', async () => {
    const outcome = await transactions
      .run(async (tx) => {
        const { rows } = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        await admin.query('select pg_terminate_backend($1)', [rows[0]?.pid]);
        await pause(300); // sin consulta en marcha: el cliente recibe el cierre
        await tx.execute(sql`select 1`);
      })
      .then(
        () => 'sin error',
        (error: unknown) => error,
      );
    await pause(100);
    expect(outcome).toBeInstanceOf(Error); // el error original sale (no se traga)
    expect(uncaught.map((error) => error.message)).toEqual([]);
    expect(pool.totalCount - pool.idleCount).toBe(0);
    expect((await pool.query<{ ok: number }>('select 1 as ok')).rows[0]?.ok).toBe(1);
  });

  it('idle_in_transaction_session_timeout (25P03) entre dos sentencias: no hay excepción no capturada', async () => {
    const short = createPool(settings(200));
    try {
      const outcome = await new Transactions(short)
        .run(async (tx) => {
          await tx.execute(sql`select 1`);
          await pause(700); // más que el límite: el servidor cierra la sesión
          await tx.execute(sql`select 2`);
        })
        .then(
          () => 'sin error',
          (error: unknown) => error,
        );
      await pause(100);
      expect(outcome).toBeInstanceOf(Error);
      expect(uncaught.map((error) => error.message)).toEqual([]);
      expect(short.totalCount - short.idleCount).toBe(0);
    } finally {
      await short.end();
    }
  });
});
