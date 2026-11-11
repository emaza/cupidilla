import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, lte } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { Clock } from '../common/clock.js';
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

/** Token de 256 bits en base64url: 43 caracteres. */
export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 en hexadecimal: es lo único que se guarda de un token. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
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
    const token = generateSessionToken();
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    await db
      .insert(sessions)
      .values({ tokenHash: hashSessionToken(token), userId, createdAt: now, expiresAt });
    return { token, expiresAt };
  }

  /** Valida la sesión: borra la caducada y renueva la que ha consumido más de la mitad de su duración. */
  async validate(tokenHash: string): Promise<ActiveSession | null> {
    const [row] = await this.db
      .select({
        expiresAt: sessions.expiresAt,
        id: users.id,
        email: users.email,
        createdAt: users.createdAt,
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
    return { userId: row.id, tokenHash, expiresAt, renewed, user: toPublicUser(row) };
  }

  async revoke(tokenHash: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }

  async deleteExpiredForUser(userId: string): Promise<void> {
    await this.db
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), lte(sessions.expiresAt, this.clock.now())));
  }
}
