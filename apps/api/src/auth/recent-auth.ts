import { RECENT_AUTH_MAX_AGE_MINUTES } from '@cupidilla/contracts';
import { eq } from 'drizzle-orm';
import { ApiException } from '../common/errors/api.exception.js';
import type { Executor } from '../database/database.types.js';
import { sessions } from '../database/schema/index.js';

const MAX_AGE_MS = RECENT_AUTH_MAX_AGE_MINUTES * 60_000;

/**
 * Sesión reciente (técnico terceros §9.1): la identidad se demostró hace menos de 10 minutos.
 * La exigen el borrado sin contraseña, añadir un proveedor y crear una contraseña.
 */
export function isRecent(authenticatedAt: Date, now: Date): boolean {
  return now.getTime() - authenticatedAt.getTime() < MAX_AGE_MS;
}

export const reauthenticationRequired = (): ApiException =>
  new ApiException('REAUTHENTICATION_REQUIRED', 403, undefined, 'Recent authentication required');

/** Lanza 403 `REAUTHENTICATION_REQUIRED` si la sesión no es reciente. */
export function assertRecent(session: { authenticatedAt: Date }, now: Date): void {
  if (!isRecent(session.authenticatedAt, now)) throw reauthenticationRequired();
}

/**
 * La sesión acaba de demostrar la identidad otra vez (contraseña o proveedor). Ni crear una
 * contraseña ni añadir un proveedor la cambian (T17).
 */
export async function markSessionAuthenticated(
  db: Executor,
  tokenHash: string,
  now: Date,
): Promise<void> {
  await db.update(sessions).set({ authenticatedAt: now }).where(eq(sessions.tokenHash, tokenHash));
}
