import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema/index.js';

/** Token de inyección de la conexión Drizzle. */
export const DB = Symbol('DB');

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Los métodos de escritura aceptan la conexión o una transacción abierta por quien coordina. */
export type Executor = Database | Tx;
