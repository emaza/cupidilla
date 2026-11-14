import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, lte } from 'drizzle-orm';
import { Clock } from '../common/clock.js';
import { generateOpaqueToken, hashOpaqueToken } from '../common/crypto/opaque-token.js';
import type { ActiveSession } from '../common/decorators/current-session.decorator.js';
import type { Env } from '../config/env.schema.js';
import { DB, type Database, type Executor } from '../database/database.types.js';
import { sessions, users } from '../database/schema/index.js';
import { toPublicUser } from '../users/users.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Una sesión se renueva cuando le queda menos de la mitad de su duración: así hay como mucho
 * una escritura por sesión cada `ttl / 2`, sea cual sea `SESSION_TTL_DAYS`.
 */
export function needsRenewal(expiresAt: Date, now: Date, ttlMs: number): boolean {
  return expiresAt.getTime() - now.getTime() < ttlMs / 2;
}

@Injectable()
export class SessionsService {
  private readonly ttlMs: number;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
  ) {
    this.ttlMs = config.get('SESSION_TTL_DAYS', { infer: true }) * DAY_MS;
  }

  async create(db: Executor, userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = generateOpaqueToken();
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    // Una sesión nueva acaba de demostrar la identidad: authenticated_at = created_at (§5.1).
    await db.insert(sessions).values({
      tokenHash: hashOpaqueToken(token),
      userId,
      createdAt: now,
      authenticatedAt: now,
      expiresAt,
    });
    return { token, expiresAt };
  }

  /** Valida la sesión: borra la caducada y renueva la que ha consumido más de la mitad de su duración. */
  async validate(tokenHash: string): Promise<ActiveSession | null> {
    const [row] = await this.db
      .select({
        expiresAt: sessions.expiresAt,
        authenticatedAt: sessions.authenticatedAt,
        id: users.id,
        email: users.email,
        createdAt: users.createdAt,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);
    if (!row) return null;

    const now = this.clock.now();
    if (row.expiresAt.getTime() <= now.getTime()) {
      await this.revoke(tokenHash);
      return null;
    }

    let expiresAt = row.expiresAt;
    let renewed = false;
    if (needsRenewal(expiresAt, now, this.ttlMs)) {
      expiresAt = new Date(now.getTime() + this.ttlMs);
      renewed = true;
      await this.db.update(sessions).set({ expiresAt }).where(eq(sessions.tokenHash, tokenHash));
    }
    return {
      userId: row.id,
      tokenHash,
      expiresAt,
      authenticatedAt: row.authenticatedAt,
      renewed,
      user: toPublicUser(row),
    };
  }

  async revoke(tokenHash: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }

  /**
   * Cierra todas las sesiones de la cuenta (correo §4.1, §5.6). Sus `oauth_states`
   * (reautenticaciones y uniones a medias) desaparecen en cascada. Devuelve cuántas cerró.
   */
  async revokeAllForUser(db: Executor, userId: string): Promise<number> {
    const revoked = await db
      .delete(sessions)
      .where(eq(sessions.userId, userId))
      .returning({ tokenHash: sessions.tokenHash });
    return revoked.length;
  }

  async deleteExpiredForUser(userId: string): Promise<void> {
    await this.db
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), lte(sessions.expiresAt, this.clock.now())));
  }
}
