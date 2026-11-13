import { sql } from 'drizzle-orm';
import { check, date, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    // NULL en las cuentas creadas con un proveedor y sin contraseña (§5.1).
    passwordHash: text('password_hash'),
    birthDate: date('birth_date', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('users_email_unique').on(t.email),
    check('users_email_normalized', sql`${t.email} = lower(btrim(${t.email}))`),
    check('users_email_length', sql`char_length(${t.email}) between 3 and 254`),
    check('users_birth_date_min', sql`${t.birthDate} >= date '1900-01-01'`),
  ],
);
