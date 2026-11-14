import { Injectable } from '@nestjs/common';
import type { EmailTokenPurpose } from '@cupidilla/contracts';
import { and, eq, gt, lte } from 'drizzle-orm';
import { Clock } from '../common/clock.js';
import { generateOpaqueToken, hashOpaqueToken } from '../common/crypto/opaque-token.js';
import type { Executor, Tx } from '../database/database.types.js';
import { emailTokens } from '../database/schema/index.js';

export type EmailTokenRow = typeof emailTokens.$inferSelect;

/**
 * Correo enmascarado para mostrar a quien tiene el enlace (correo §5.4): primera letra, `•••` y
 * el dominio. `beto@example.com` → `b•••@example.com`.
 */
export function emailHint(email: string): string {
  const at = email.lastIndexOf('@');
  return `${[...email.slice(0, Math.max(at, 0))][0] ?? ''}•••${email.slice(at)}`;
}

/**
 * Tokens de los enlaces de los correos (correo §3.2). Solo se guarda su SHA-256; un token vivo
 * por usuario y propósito (`email_tokens_user_purpose_unique`); consumir es `DELETE … RETURNING`.
 */
@Injectable()
export class EmailTokensService {
  constructor(private readonly clock: Clock) {}

  /**
   * Emite un token nuevo y anula el anterior del mismo usuario y propósito. Devuelve el token en
   * claro, que solo vive en memoria hasta ir en el correo. La caducidad cuenta desde ahora.
   */
  async issue(
    tx: Tx,
    input: { userId: string; purpose: EmailTokenPurpose; email: string; ttlMs: number },
  ): Promise<string> {
    const token = generateOpaqueToken();
    const now = this.clock.now();
    await tx
      .delete(emailTokens)
      .where(and(eq(emailTokens.userId, input.userId), eq(emailTokens.purpose, input.purpose)));
    await tx.insert(emailTokens).values({
      tokenHash: hashOpaqueToken(token),
      userId: input.userId,
      purpose: input.purpose,
      email: input.email,
      createdAt: now,
      expiresAt: new Date(now.getTime() + input.ttlMs),
    });
    return token;
  }

  /** Token vivo (sin caducar) de ese propósito, sin consumirlo. */
  async findLive(
    db: Executor,
    token: string,
    purpose: EmailTokenPurpose,
  ): Promise<EmailTokenRow | undefined> {
    const [row] = await db
      .select()
      .from(emailTokens)
      .where(this.liveToken(token, purpose))
      .limit(1);
    return row;
  }

  /** Consume el token: un solo uso atómico. `undefined` si no existe, caducó o es de otro propósito. */
  async consume(
    tx: Tx,
    token: string,
    purpose: EmailTokenPurpose,
  ): Promise<EmailTokenRow | undefined> {
    const [row] = await tx.delete(emailTokens).where(this.liveToken(token, purpose)).returning();
    return row;
  }

  async deleteForUser(db: Executor, userId: string, purpose?: EmailTokenPurpose): Promise<void> {
    await db
      .delete(emailTokens)
      .where(
        purpose === undefined
          ? eq(emailTokens.userId, userId)
          : and(eq(emailTokens.userId, userId), eq(emailTokens.purpose, purpose)),
      );
  }

  /** Limpieza (correo §4.3): borra los tokens caducados. */
  async deleteExpired(db: Executor): Promise<number> {
    const deleted = await db
      .delete(emailTokens)
      .where(lte(emailTokens.expiresAt, this.clock.now()))
      .returning({ tokenHash: emailTokens.tokenHash });
    return deleted.length;
  }

  emailHint(email: string): string {
    return emailHint(email);
  }

  private liveToken(token: string, purpose: EmailTokenPurpose) {
    return and(
      eq(emailTokens.tokenHash, hashOpaqueToken(token)),
      eq(emailTokens.purpose, purpose),
      gt(emailTokens.expiresAt, this.clock.now()),
    );
  }
}
