import { eq } from 'drizzle-orm';
import type { Executor } from '../database/database.types.js';
import { sessions } from '../database/schema/index.js';

/**
 * La sesión acaba de demostrar la identidad otra vez (contraseña o proveedor). Ni crear una
 * contraseña ni añadir un proveedor la cambian (T17). Desde la decisión 21 ninguna operación
 * depende de que la sesión sea reciente: `authenticated_at` solo se muestra en /account.
 */
export async function markSessionAuthenticated(
  db: Executor,
  tokenHash: string,
  now: Date,
): Promise<void> {
  await db.update(sessions).set({ authenticatedAt: now }).where(eq(sessions.tokenHash, tokenHash));
}
