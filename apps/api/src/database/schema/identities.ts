import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/** Identidad de un proveedor unida a una cuenta (§5.2). No se guarda ningún token del proveedor. */
export const identities = pgTable(
  'identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: ['google', 'facebook'] }).notNull(),
    // `sub` de Google; `id` de Facebook, que es único por app.
    subject: text('subject').notNull(),
    // Último correo que dio el proveedor, normalizado como users.email.
    providerEmail: text('provider_email'),
    emailVerified: boolean('email_verified').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('identities_provider_subject_unique').on(t.provider, t.subject),
    // Su columna inicial (user_id) cubre también el borrado en cascada: no hace falta otro índice.
    unique('identities_user_provider_unique').on(t.userId, t.provider),
    check('identities_provider_known', sql`${t.provider} in ('google', 'facebook')`),
    check('identities_subject_length', sql`char_length(${t.subject}) between 1 and 255`),
  ],
);
