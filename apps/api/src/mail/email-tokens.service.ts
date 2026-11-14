import { Injectable } from '@nestjs/common';
import { EMAIL_TOKEN_MAX_FAILURES, type EmailTokenPurpose } from '@cupidilla/contracts';
import { and, eq, gt, lt, lte, sql } from 'drizzle-orm';
import { Clock } from '../common/clock.js';
import { generateOpaqueToken, hashOpaqueToken } from '../common/crypto/opaque-token.js';
import type { Executor, Tx } from '../database/database.types.js';
import { emailTokens, users } from '../database/schema/index.js';

export type EmailTokenRow = typeof emailTokens.$inferSelect;

/** La cuenta de un enlace vivo, con lo que necesitan la comprobación y la confirmación. */
export interface EmailTokenAccount {
  token: EmailTokenRow;
  user: Pick<
    typeof users.$inferSelect,
    'id' | 'email' | 'createdAt' | 'emailVerifiedAt' | 'passwordHash'
  >;
}

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

  /**
   * Enlace vivo con su cuenta, sin consumirlo (correo §5.4). Solo vale si el correo del token
   * sigue siendo el de la cuenta (`email_tokens.email = users.email`).
   */
  async findLiveForAccount(
    db: Executor,
    token: string,
    purpose: EmailTokenPurpose,
  ): Promise<EmailTokenAccount | undefined> {
    const [row] = await db
      .select({
        token: emailTokens,
        user: {
          id: users.id,
          email: users.email,
          createdAt: users.createdAt,
          emailVerifiedAt: users.emailVerifiedAt,
          passwordHash: users.passwordHash,
        },
      })
      .from(emailTokens)
      .innerJoin(users, and(eq(users.id, emailTokens.userId), eq(users.email, emailTokens.email)))
      .where(this.liveToken(token, purpose))
      .limit(1);
    return row;
  }

  /**
   * Una contraseña errónea más al confirmar con este enlace (correo §5.4). Nunca pasa del tope:
   * devuelve los fallos acumulados, o `undefined` si el enlace ya no existe o ya estaba en el tope.
   */
  async recordFailure(
    db: Executor,
    token: string,
    purpose: EmailTokenPurpose,
  ): Promise<number | undefined> {
    const [row] = await db
      .update(emailTokens)
      .set({ failedAttempts: sql`${emailTokens.failedAttempts} + 1` })
      .where(this.liveToken(token, purpose))
      .returning({ failedAttempts: emailTokens.failedAttempts });
    return row?.failedAttempts;
  }

  /** Borra el enlace, exista o no (5.º fallo de contraseña). */
  async delete(db: Executor, token: string): Promise<void> {
    await db.delete(emailTokens).where(eq(emailTokens.tokenHash, hashOpaqueToken(token)));
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

  /**
   * Vivo: ese hash y propósito, sin caducar y por debajo del tope de fallos. Un enlace que llegó a
   * 5 fallos ya no vale aunque su fila no se haya borrado todavía (una contraseña correcta
   * simultánea al 5.º fallo no lo consume).
   */
  private liveToken(token: string, purpose: EmailTokenPurpose) {
    return and(
      eq(emailTokens.tokenHash, hashOpaqueToken(token)),
      eq(emailTokens.purpose, purpose),
      gt(emailTokens.expiresAt, this.clock.now()),
      lt(emailTokens.failedAttempts, EMAIL_TOKEN_MAX_FAILURES),
    );
  }
}
