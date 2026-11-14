import { sql } from 'drizzle-orm';
import type { Tx } from './database.types.js';

/** Normalización de `users.email` y `identities.provider_email` (`emailSchema`). */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Bloqueo transaccional por correo: serializa las altas y las escrituras de `provider_email` del
 * mismo correo, que no tienen una UNIQUE común entre tablas. Se libera en COMMIT o ROLLBACK, así
 * que solo sirve dentro de `Transactions.run`.
 */
export async function lockEmail(tx: Tx, email: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`email:${normalizeEmail(email)}`}, 0))`,
  );
}
