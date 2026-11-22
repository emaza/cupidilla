import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { contactMessages } from '../src/database/schema/index.js';
import { OutboxService } from '../src/mail/outbox.service.js';
import { CONTACT_INBOX, CONTACT_NOW } from './helpers/contact.js';
import { countRows, createTestApp, truncateAll, type TestApp } from './helpers/test-app.js';

/** Esquema de contacto y cambios del *outbox* (técnico de contacto §3, tarea T2). */
describe('T2: contact_messages y email_outbox.contact_message_id', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ now: CONTACT_NOW });
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await truncateAll(t.db);
  });

  async function expectViolation(query: SQL, constraint: string): Promise<void> {
    await expect(t.db.execute(query)).rejects.toMatchObject({
      cause: { code: '23514', constraint },
    });
  }

  const valid = {
    name: "'Lucía'",
    email: "'lucia@example.com'",
    phone: 'null',
    subject: "'Duda sobre mi cuenta'",
    message: "'Un mensaje de prueba.'",
    privacy_policy_version: "'2026-11-borrador'",
    created_at: `'${CONTACT_NOW}'`,
    notified_at: 'null',
  };
  /** INSERT con los valores válidos salvo los que se cambian (en SQL literal). */
  const insertWith = (overrides: Partial<typeof valid>): SQL => {
    const row = { ...valid, ...overrides };
    return sql.raw(
      `insert into contact_messages (${Object.keys(row).join(', ')}) values (${Object.values(row).join(', ')})`,
    );
  };

  it.each([
    [{ name: "''" }, 'contact_messages_name_length'],
    [{ name: `'${'a'.repeat(101)}'` }, 'contact_messages_name_length'],
    [{ name: "E'Eve\\nBcc'" }, 'contact_messages_name_single_line'],
    [{ email: "'Lucia@example.com'" }, 'contact_messages_email_normalized'],
    [{ phone: "'12345'" }, 'contact_messages_phone_format'],
    [{ phone: "'600-ABC-123'" }, 'contact_messages_phone_format'],
    [{ subject: "'ab'" }, 'contact_messages_subject_length'],
    [{ subject: `'${'a'.repeat(121)}'` }, 'contact_messages_subject_length'],
    [{ subject: "E'Hola\\r\\nBcc: x'" }, 'contact_messages_subject_single_line'],
    [{ message: "'corto'" }, 'contact_messages_message_length'],
    [{ message: `'${'a'.repeat(3001)}'` }, 'contact_messages_message_length'],
    [{ privacy_policy_version: "''" }, 'contact_messages_policy_version_length'],
    [{ notified_at: "'2026-11-21T10:00:00Z'" }, 'contact_messages_notified_after_created'],
  ])('%o viola %s', async (overrides, constraint) => {
    await expectViolation(insertWith(overrides), constraint);
  });

  it('los valores válidos entran, con saltos de línea en el mensaje y un teléfono', async () => {
    await t.db.execute(insertWith({ phone: "'+34 600 11 22 33'", message: "E'Hola,\\nqué tal'" }));
    expect(await countRows(t.db, 'contact_messages')).toBe(1);
  });

  async function newMessage(): Promise<string> {
    const [row] = await t.db
      .insert(contactMessages)
      .values({
        name: 'Lucía',
        email: 'lucia@example.com',
        subject: 'Asunto',
        message: 'Un mensaje de prueba.',
        privacyPolicyVersion: '2026-11-borrador',
        createdAt: new Date(CONTACT_NOW),
      })
      .returning({ id: contactMessages.id });
    if (!row) throw new Error('INSERT sin fila');
    return row.id;
  }

  const outboxInsert = (kind: string, id: string | null) => sql`
    insert into email_outbox (kind, to_email, contact_message_id, next_attempt_at, created_at)
    values (${kind}, ${CONTACT_INBOX}, ${id}, ${CONTACT_NOW}, ${CONTACT_NOW})`;

  it('email_outbox_contact_ref: contacto sin referencia y cuenta con ella fallan', async () => {
    const id = await newMessage();
    await expectViolation(outboxInsert('contact_message', null), 'email_outbox_contact_ref');
    await expectViolation(outboxInsert('contact_ack', null), 'email_outbox_contact_ref');
    await expectViolation(outboxInsert('verify_email', id), 'email_outbox_contact_ref');
  });

  it('dos verify_email pendientes a la misma dirección siguen colapsando (C20)', async () => {
    const outbox = t.app.get(OutboxService);
    await outbox.enqueue(t.db, 'verify_email', 'beto@example.com');
    await outbox.enqueue(t.db, 'verify_email', 'beto@example.com');
    expect(await countRows(t.db, 'email_outbox')).toBe(1);
  });

  it('dos mensajes distintos a la misma dirección no colapsan; el mismo mensaje sí', async () => {
    const outbox = t.app.get(OutboxService);
    const first = await newMessage();
    const second = await newMessage();
    await outbox.enqueueContact(t.db, 'contact_message', CONTACT_INBOX, first);
    await outbox.enqueueContact(t.db, 'contact_message', CONTACT_INBOX, second);
    await outbox.enqueueContact(t.db, 'contact_message', CONTACT_INBOX, first);
    await outbox.enqueueContact(t.db, 'contact_ack', 'lucia@example.com', first);
    expect(await countRows(t.db, 'email_outbox')).toBe(3);
  });

  it('borrar un mensaje borra sus filas del outbox', async () => {
    const outbox = t.app.get(OutboxService);
    const id = await newMessage();
    await outbox.enqueueContact(t.db, 'contact_message', CONTACT_INBOX, id);
    await outbox.enqueueContact(t.db, 'contact_ack', 'lucia@example.com', id);
    await t.db.execute(sql`delete from contact_messages where id = ${id}`);
    expect(await countRows(t.db, 'email_outbox')).toBe(0);
  });
});
