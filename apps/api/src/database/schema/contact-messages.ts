import {
  CONTACT_MESSAGE_MAX,
  CONTACT_MESSAGE_MIN,
  CONTACT_NAME_MAX,
  CONTACT_PHONE_DIGITS_MIN,
  CONTACT_PHONE_MAX,
  CONTACT_SUBJECT_MAX,
  CONTACT_SUBJECT_MIN,
} from '@cupidilla/contracts';
import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Mensajes del formulario de contacto (técnico de contacto §3.1). Sin IP, *user agent* ni
 * `user_id` (A3, A8). Las longitudes son las de `contracts` y cuentan caracteres, como el
 * esquema: estas CHECK son la red de seguridad. Se borran a los 180 días (§9).
 */
export const contactMessages = pgTable(
  'contact_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    // Normalizado, como users.email.
    email: text('email').notNull(),
    // NULL si no se escribe.
    phone: text('phone'),
    subject: text('subject').notNull(),
    message: text('message').notNull(),
    // La versión aceptada; el instante es created_at.
    privacyPolicyVersion: text('privacy_policy_version').notNull(),
    // Del Clock, no defaultNow(): los tests usan FakeClock.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    // Cuándo aceptó el SMTP el correo interno. NULL durante horas = el buzón no lo ha recibido.
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    // Si al recibirlo se encoló el acuse (CONTACT_ACK_EMAIL en ese momento). El correo interno lo
    // dice así, aunque la variable cambie antes de enviarlo.
    ackRequested: boolean('ack_requested').notNull().default(false),
  },
  (t) => [
    index('contact_messages_created_at_idx').on(t.createdAt),
    check(
      'contact_messages_name_length',
      sql`char_length(${t.name}) between 1 and ${sql.raw(String(CONTACT_NAME_MAX))}`,
    ),
    check('contact_messages_name_single_line', sql`${t.name} !~ '[[:cntrl:]]'`),
    check('contact_messages_email_normalized', sql`${t.email} = lower(btrim(${t.email}))`),
    check('contact_messages_email_length', sql`char_length(${t.email}) between 3 and 254`),
    check(
      'contact_messages_phone_format',
      sql`${t.phone} is null or (char_length(${t.phone}) between ${sql.raw(String(CONTACT_PHONE_DIGITS_MIN))} and ${sql.raw(String(CONTACT_PHONE_MAX))} and ${t.phone} ~ '^\\+?[0-9 ().-]+$')`,
    ),
    check(
      'contact_messages_subject_length',
      sql`char_length(${t.subject}) between ${sql.raw(String(CONTACT_SUBJECT_MIN))} and ${sql.raw(String(CONTACT_SUBJECT_MAX))}`,
    ),
    check('contact_messages_subject_single_line', sql`${t.subject} !~ '[[:cntrl:]]'`),
    check(
      'contact_messages_message_length',
      sql`char_length(${t.message}) between ${sql.raw(String(CONTACT_MESSAGE_MIN))} and ${sql.raw(String(CONTACT_MESSAGE_MAX))}`,
    ),
    check(
      'contact_messages_policy_version_length',
      sql`char_length(${t.privacyPolicyVersion}) between 1 and 64`,
    ),
    check(
      'contact_messages_notified_after_created',
      sql`${t.notifiedAt} is null or ${t.notifiedAt} >= ${t.createdAt}`,
    ),
  ],
);
