import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const sessions = pgTable(
  'sessions',
  {
    // SHA-256 del token en hexadecimal: el token en claro nunca se guarda.
    tokenHash: text('token_hash').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Última vez que se demostró la identidad en esta sesión (§9.1). Sin DEFAULT a propósito:
    // la migración rellenó las sesiones existentes con created_at, no con now().
    authenticatedAt: timestamp('authenticated_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
    check('sessions_token_hash_format', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
  ],
);
