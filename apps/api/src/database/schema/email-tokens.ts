import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * Enlaces de los correos (correo §3.2): solo el SHA-256 del token, un token vivo por usuario y
 * propósito, y un solo uso (`DELETE … RETURNING`).
 */
export const emailTokens = pgTable(
  'email_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose', { enum: ['verify_email', 'reset_password'] }).notNull(),
    // `users.email` al emitirlo: si ya no coincide al consumirlo, el token no vale.
    email: text('email').notNull(),
    // Contraseñas erróneas al verificar sin la sesión de la cuenta (§5.4).
    failedAttempts: smallint('failed_attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('email_tokens_user_purpose_unique').on(t.userId, t.purpose),
    index('email_tokens_expires_at_idx').on(t.expiresAt),
    check('email_tokens_token_hash_format', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check('email_tokens_purpose_known', sql`${t.purpose} in ('verify_email', 'reset_password')`),
    check('email_tokens_failed_attempts_range', sql`${t.failedAttempts} between 0 and 5`),
  ],
);
