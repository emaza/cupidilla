import { Inject, Injectable, Logger } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { PG_POOL, type Tx } from './database.types.js';
import { isConnectionLost } from './pg-errors.js';
import * as schema from './schema/index.js';

const asError = (value: unknown): Error =>
  value instanceof Error ? value : new Error('Transaction failed');

const logger = new Logger('Database');

/**
 * Presta un cliente del pool a `fn` y lo devuelve siempre (§7.2).
 * - Mientras está prestado, escucha su evento `error`: el listener del pool solo cubre los
 *   clientes libres, y sin este, un cierre de sesión del servidor entre dos sentencias
 *   (reinicio, `pg_terminate_backend`, 25P03) sería una excepción no capturada que tumba la API.
 *   Solo se registra el `code` (§8.9).
 * - `fn` recibe `discard(error)` para pedir que el cliente se descarte en lugar de volver al pool.
 *   Un cliente que ha emitido `error` se descarta siempre.
 */
export async function withPoolClient<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient, state: { broken: Error | undefined }) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  const state: { broken: Error | undefined } = { broken: undefined };
  const onError = (error: Error & { code?: unknown }) => {
    logger.error({
      event: 'pg_client_error',
      code: typeof error.code === 'string' ? error.code : null,
    });
    state.broken ??= error;
  };
  client.on('error', onError);
  try {
    return await fn(client, state);
  } finally {
    client.off('error', onError);
    client.release(state.broken);
  }
}

/**
 * Transacciones sobre el pool, en lugar de `db.transaction` de Drizzle 0.45, que ejecuta BEGIN
 * fuera del `try` (si falla, no libera el cliente y el pool se agota), devuelve al pool clientes
 * rotos y deja que un fallo del ROLLBACK tape el error original (§7.2).
 */
@Injectable()
export class Transactions {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  /**
   * Ejecuta `fn` entre BEGIN y COMMIT en un único cliente.
   * - Error normal (p. ej. unicidad): ROLLBACK y el cliente vuelve al pool.
   * - Conexión perdida o muda (`isConnectionLost`), o el servidor cerró la sesión (el cliente
   *   emitió `error`): sin ROLLBACK, que esperaría en vano o fallaría; el cliente se descarta
   *   (`release(error)`) y PostgreSQL deshace al ver la conexión cerrada.
   * - Si el ROLLBACK falla, también se descarta. El error que sale es siempre el original.
   */
  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withPoolClient(this.pool, async (client, state) => {
      try {
        await client.query('begin');
        const result = await fn(drizzle(client, { schema }));
        await client.query('commit');
        return result;
      } catch (error) {
        if (!state.broken && isConnectionLost(error)) state.broken = asError(error);
        if (!state.broken) {
          try {
            await client.query('rollback');
          } catch (rollbackError) {
            state.broken = asError(rollbackError);
          }
        }
        throw error;
      }
    });
  }
}
