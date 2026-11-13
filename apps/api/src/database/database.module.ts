import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Env } from '../config/env.schema.js';
import { DB, PG_POOL } from './database.types.js';
import * as schema from './schema/index.js';
import { markNotSent } from './pg-errors.js';
import { Transactions } from './transactions.js';

/**
 * Margen del límite del cliente (`query_timeout`) sobre `statement_timeout`: normalmente cancela
 * el servidor; el cliente solo corta si el servidor no contesta (red muda, PostgreSQL congelado).
 */
export const QUERY_TIMEOUT_MARGIN_MS = 500;

export type PoolSettings = Pick<
  Env,
  | 'DATABASE_URL'
  | 'DB_CONNECTION_TIMEOUT_MS'
  | 'DB_STATEMENT_TIMEOUT_MS'
  | 'DB_IDLE_IN_TRANSACTION_TIMEOUT_MS'
>;

/**
 * Pool de PostgreSQL con límites de tiempo finitos (§7.2):
 * - `connectionTimeoutMillis`: lo máximo que se espera a conseguir una conexión.
 * - `statement_timeout` e `idle_in_transaction_session_timeout` viajan al servidor al conectar:
 *   PostgreSQL cancela la consulta (o cierra la sesión) y deshace la transacción.
 * - `query_timeout` (= statement_timeout + 500 ms) lo aplica el cliente: cubre una conexión ya
 *   abierta con un servidor que ha dejado de responder sin cerrarla, que el servidor no puede
 *   cancelar. pg rechaza la consulta, aunque PostgreSQL podría seguir ejecutándola.
 *
 * Escucha `error`: un cliente inactivo puede fallar (por ejemplo, si PostgreSQL se reinicia) y,
 * sin listener, el proceso caería. Solo se registra el `code`: el mensaje puede llevar la
 * cadena de conexión (§8.9).
 */
export function createPool(settings: PoolSettings): pg.Pool {
  const pool = new pg.Pool({
    connectionString: settings.DATABASE_URL,
    connectionTimeoutMillis: settings.DB_CONNECTION_TIMEOUT_MS,
    statement_timeout: settings.DB_STATEMENT_TIMEOUT_MS,
    query_timeout: settings.DB_STATEMENT_TIMEOUT_MS + QUERY_TIMEOUT_MARGIN_MS,
    idle_in_transaction_session_timeout: settings.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  });
  // Todo error al conseguir un cliente (también el de un `query` suelto, que pasa por aquí) se
  // marca: no se llegó a enviar nada, así que nunca es «resultado incierto» (§6.3).
  type ConnectCallback = Parameters<pg.Pool['connect']>[0] & {};
  const connect = pool.connect.bind(pool) as (
    callback?: ConnectCallback,
  ) => Promise<pg.PoolClient> | undefined;
  pool.connect = ((callback?: ConnectCallback) => {
    if (callback) {
      void connect((error, client, done) => {
        callback(markNotSent(error), client, done);
      });
      return undefined;
    }
    return (connect() as Promise<pg.PoolClient>).catch((error: unknown) => {
      throw markNotSent(error);
    });
  }) as pg.Pool['connect'];

  const logger = new Logger('Database');
  pool.on('error', (error: Error & { code?: unknown }) => {
    logger.error({
      event: 'pg_pool_error',
      code: typeof error.code === 'string' ? error.code : null,
    });
  });
  return pool;
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createPool({
          DATABASE_URL: config.get('DATABASE_URL', { infer: true }),
          DB_CONNECTION_TIMEOUT_MS: config.get('DB_CONNECTION_TIMEOUT_MS', { infer: true }),
          DB_STATEMENT_TIMEOUT_MS: config.get('DB_STATEMENT_TIMEOUT_MS', { infer: true }),
          DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: config.get('DB_IDLE_IN_TRANSACTION_TIMEOUT_MS', {
            infer: true,
          }),
        }),
    },
    {
      provide: DB,
      inject: [PG_POOL],
      useFactory: (pool: pg.Pool) => drizzle(pool, { schema }),
    },
    Transactions,
  ],
  exports: [DB, Transactions],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
