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
import { contactMessages } from './contact-messages.js';

/**
 * Correos pendientes de enviar (correo §3.3). Sin `user_id` ni secretos: el *worker* decide al
 * enviar a quién pertenece la dirección, qué variante toca y, si lleva enlace, genera el token.
 * Los dos tipos de contacto llevan además `contact_message_id` (técnico de contacto §3.2): el
 * contenido se lee de `contact_messages` al enviar y nunca se copia aquí.
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
        'contact_message',
        'contact_ack',
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
    // Solo en los tipos de contacto. Borrar el mensaje (retención o petición) borra sus correos.
    contactMessageId: uuid('contact_message_id').references(() => contactMessages.id, {
      onDelete: 'cascade',
    }),
  },
  (t) => [
    // Correos de cuenta: como mucho una fila pendiente por tipo y dirección (encolar es ON
    // CONFLICT DO NOTHING). Solo las filas sin referencia: los NULL serían distintos en el índice.
    uniqueIndex('email_outbox_pending_unique')
      .on(t.kind, t.toEmail)
      .where(sql`${t.failedAt} is null and ${t.contactMessageId} is null`),
    // Correos de contacto: como mucho uno pendiente de cada tipo por mensaje. Empieza por la
    // referencia para que también sirva al ON DELETE CASCADE.
    uniqueIndex('email_outbox_contact_pending_unique')
      .on(t.contactMessageId, t.kind)
      .where(sql`${t.failedAt} is null and ${t.contactMessageId} is not null`),
    index('email_outbox_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.failedAt} is null`),
    check(
      'email_outbox_kind_known',
      sql`${t.kind} in ('verify_email', 'verify_reminder', 'reset_password', 'signup_notice', 'password_changed', 'contact_message', 'contact_ack')`,
    ),
    // Los dos tipos de contacto llevan siempre la referencia y los demás nunca.
    check(
      'email_outbox_contact_ref',
      sql`(${t.kind} in ('contact_message', 'contact_ack')) = (${t.contactMessageId} is not null)`,
    ),
    check('email_outbox_to_email_normalized', sql`${t.toEmail} = lower(btrim(${t.toEmail}))`),
    check('email_outbox_to_email_length', sql`char_length(${t.toEmail}) between 3 and 254`),
    check('email_outbox_attempts_range', sql`${t.attempts} between 0 and 8`),
    check('email_outbox_last_error_length', sql`char_length(${t.lastError}) <= 64`),
  ],
);
