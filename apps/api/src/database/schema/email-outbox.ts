import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Correos pendientes de enviar (correo §3.3). Sin `user_id` ni secretos: el *worker* decide al
 * enviar a quién pertenece la dirección, qué variante toca y, si lleva enlace, genera el token.
 */
export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind', {
      enum: [
        'verify_email',
        'verify_reminder',
        'reset_password',
        'signup_notice',
        'password_changed',
      ],
    }).notNull(),
    // Normalizado, como users.email.
    toEmail: text('to_email').notNull(),
    attempts: smallint('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull(),
    // Concesión del *worker* que la está enviando.
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    // Error permanente o intentos agotados.
    failedAt: timestamp('failed_at', { withTimezone: true }),
    // Solo un código (`ESOCKET`, `smtp_421`), nunca la respuesta del servidor.
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    // Como mucho una fila pendiente por tipo y dirección: encolar es ON CONFLICT DO NOTHING.
    uniqueIndex('email_outbox_pending_unique')
      .on(t.kind, t.toEmail)
      .where(sql`${t.failedAt} is null`),
    index('email_outbox_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.failedAt} is null`),
    check(
      'email_outbox_kind_known',
      sql`${t.kind} in ('verify_email', 'verify_reminder', 'reset_password', 'signup_notice', 'password_changed')`,
    ),
    check('email_outbox_to_email_normalized', sql`${t.toEmail} = lower(btrim(${t.toEmail}))`),
    check('email_outbox_to_email_length', sql`char_length(${t.toEmail}) between 3 and 254`),
    check('email_outbox_attempts_range', sql`${t.attempts} between 0 and 8`),
    check('email_outbox_last_error_length', sql`char_length(${t.lastError}) <= 64`),
  ],
);
