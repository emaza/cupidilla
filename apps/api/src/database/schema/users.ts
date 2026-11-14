import { sql } from 'drizzle-orm';
import { check, date, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

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
    // Cuándo se demostró que el correo es de la persona (correo §3.1). NULL = sin verificar.
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    // Cuándo se encoló el recordatorio de antes del borrado (§6.3): evita enviarlo dos veces.
    verificationRemindedAt: timestamp('verification_reminded_at', { withTimezone: true }),
    // Cuándo quedó «pendiente de revisar datos» (§5.11). NULL = nada pendiente.
    dataReviewRequiredAt: timestamp('data_review_required_at', { withTimezone: true }),
  },
  (t) => [
    unique('users_email_unique').on(t.email),
    check('users_email_normalized', sql`${t.email} = lower(btrim(${t.email}))`),
    check('users_email_length', sql`char_length(${t.email}) between 3 and 254`),
    check('users_birth_date_min', sql`${t.birthDate} >= date '1900-01-01'`),
    // Una cuenta sin verificar solo nace del registro con contraseña; las de proveedor nacen
    // verificadas (§3.1, §5.10).
    check(
      'users_unverified_has_password',
      sql`${t.emailVerifiedAt} is not null or ${t.passwordHash} is not null`,
    ),
    // La marca de revisión solo la pone el restablecimiento, que a la vez verifica el correo.
    check(
      'users_review_requires_verified',
      sql`${t.dataReviewRequiredAt} is null or ${t.emailVerifiedAt} is not null`,
    ),
    // Recordatorio y borrado de cuentas sin verificar (§6.3).
    index('users_unverified_created_at_idx')
      .on(t.createdAt)
      .where(sql`${t.emailVerifiedAt} is null`),
  ],
);
