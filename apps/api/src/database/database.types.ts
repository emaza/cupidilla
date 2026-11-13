import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema/index.js';

/** Token de inyección de la conexión Drizzle. */
export const DB = Symbol('DB');
/** Token de inyección del `pg.Pool` (solo dentro de `database/`). */
export const PG_POOL = Symbol('PG_POOL');

export type Database = NodePgDatabase<typeof schema>;
/**
 * Transacción abierta con `Transactions.run`: una conexión Drizzle sobre un único cliente del
 * pool, entre BEGIN y COMMIT. No se usa `db.transaction` de Drizzle (§7.2).
 */
export type Tx = Database;
/** Los métodos de escritura aceptan la conexión o una transacción abierta por quien coordina. */
export type Executor = Database | Tx;
