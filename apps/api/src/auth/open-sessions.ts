import { ACCOUNT_SESSIONS_LIMIT } from '@cupidilla/contracts';
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import type { Executor } from '../database/database.types.js';
import { sessions } from '../database/schema/index.js';

export interface OpenSession {
  createdAt: Date;
  authenticatedAt: Date;
  expiresAt: Date;
  current: boolean;
}

/**
 * Sesiones sin caducar de un usuario para GET /users/me: primero la actual y después de la más
 * nueva a la más antigua, como mucho `ACCOUNT_SESSIONS_LIMIT`. Solo se leen fechas: el hash del
 * token se compara en SQL y no sale de la base. Las caducadas no se borran aquí, solo se omiten.
 * Función libre, como `recent-auth.ts`, para no crear una dependencia circular entre
 * `UsersModule` y `AuthModule`.
 */
export async function listOpenSessions(
  db: Executor,
  userId: string,
  currentTokenHash: string,
  now: Date,
): Promise<OpenSession[]> {
  const current = sql<boolean>`${sessions.tokenHash} = ${currentTokenHash}`;
  return (
    db
      .select({
        createdAt: sessions.createdAt,
        authenticatedAt: sessions.authenticatedAt,
        expiresAt: sessions.expiresAt,
        current,
      })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, now)))
      // `token_hash` desempata dos sesiones creadas en el mismo instante: el orden es estable.
      .orderBy(desc(current), desc(sessions.createdAt), asc(sessions.tokenHash))
      .limit(ACCOUNT_SESSIONS_LIMIT)
  );
}
