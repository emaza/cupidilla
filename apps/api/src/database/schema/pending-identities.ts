import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

/** Alta o unión pendiente tras volver del proveedor (§5.4): un solo uso y 30 minutos. */
export const pendingIdentities = pgTable(
  'pending_identities',
  {
    // SHA-256 del pendingToken de la cookie `cupidilla_oauth`.
    tokenHash: text('token_hash').primaryKey(),
    kind: text('kind', { enum: ['signup', 'link'] }).notNull(),
    provider: text('provider', { enum: ['google', 'facebook'] }).notNull(),
    subject: text('subject').notNull(),
    // Sin correo fiable no se llega aquí (§6).
    providerEmail: text('provider_email').notNull(),
    emailVerified: boolean('email_verified').notNull(),
    // La cuenta con contraseña a la que se unirá la identidad (solo con kind = 'link').
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    entryPoint: text('entry_point', { enum: ['login', 'register'] }).notNull(),
    returnPath: text('return_path'),
    failedAttempts: smallint('failed_attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('pending_identities_expires_at_idx').on(t.expiresAt),
    index('pending_identities_user_id_idx').on(t.userId),
    check('pending_identities_token_hash_format', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check('pending_identities_kind_known', sql`${t.kind} in ('signup', 'link')`),
    check('pending_identities_provider_known', sql`${t.provider} in ('google', 'facebook')`),
    check('pending_identities_subject_length', sql`char_length(${t.subject}) between 1 and 255`),
    check('pending_identities_entry_point_known', sql`${t.entryPoint} in ('login', 'register')`),
    check('pending_identities_return_path_length', sql`char_length(${t.returnPath}) <= 64`),
    check('pending_identities_failed_attempts_range', sql`${t.failedAttempts} between 0 and 5`),
    check('pending_identities_kind_shape', sql`(${t.kind} = 'link') = (${t.userId} is not null)`),
  ],
);
