import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactRetentionSweeper } from '../src/contact/contact-retention.sweeper.js';
import { contactMessages, emailOutbox } from '../src/database/schema/index.js';
import { CONTACT_INBOX, CONTACT_NOW, contactRows } from './helpers/contact.js';
import { countRows, createTestApp, truncateAll, type TestApp } from './helpers/test-app.js';

/** Retención de los mensajes de contacto (técnico de contacto §9, C14). */
describe('C14: barrido de retención de contact_messages', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ now: CONTACT_NOW });
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await truncateAll(t.db);
    t.clock.set(CONTACT_NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function insertMessage(createdAt: string): Promise<string> {
    const [row] = await t.db
      .insert(contactMessages)
      .values({
        name: 'Lucía',
        email: 'lucia@example.com',
        subject: 'Duda sobre mi cuenta',
        message: 'Un mensaje de prueba.',
        privacyPolicyVersion: '2026-11-borrador',
        createdAt: new Date(createdAt),
      })
      .returning({ id: contactMessages.id });
    if (!row) throw new Error('INSERT sin fila');
    return row.id;
  }

  it('borra el de hace 181 días con su correo fallido y deja el de hace 179', async () => {
    const old = await insertMessage('2026-05-25T10:00:00Z');
    const recent = await insertMessage('2026-05-27T10:00:00Z');
    await t.db.insert(emailOutbox).values({
      kind: 'contact_message',
      toEmail: CONTACT_INBOX,
      contactMessageId: old,
      attempts: 8,
      nextAttemptAt: new Date('2026-05-25T10:00:00Z'),
      failedAt: new Date('2026-05-25T18:00:00Z'),
      createdAt: new Date('2026-05-25T10:00:00Z'),
    });
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      output.push(String(chunk));
      return true;
    });

    expect(await t.app.get(ContactRetentionSweeper).sweep()).toBe(1);
    vi.restoreAllMocks();

    expect((await contactRows(t.db)).map((row) => row.id)).toEqual([recent]);
    expect(await countRows(t.db, 'email_outbox')).toBe(0);
    const logs = output.join('');
    expect(logs).toContain('contact_messages_deleted');
    expect(logs).toMatch(/"count":1/);
  });

  it('borra por lotes hasta vaciar lo vencido', async () => {
    const { CONTACT_RETENTION_BATCH } = await import('../src/contact/contact-retention.sweeper.js');
    const values = Array.from({ length: CONTACT_RETENTION_BATCH + 3 }, () => ({
      name: 'Lucía',
      email: 'lucia@example.com',
      subject: 'Asunto',
      message: 'Un mensaje de prueba.',
      privacyPolicyVersion: '2026-11-borrador',
      createdAt: new Date('2026-01-01T10:00:00Z'),
    }));
    await t.db.insert(contactMessages).values(values);
    expect(await t.app.get(ContactRetentionSweeper).sweep()).toBe(CONTACT_RETENTION_BATCH + 3);
    expect(await countRows(t.db, 'contact_messages')).toBe(0);
  });
});
