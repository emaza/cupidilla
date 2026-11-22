import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Las variables se leen al cargar el módulo de la aplicación: van antes de cualquier import.
vi.hoisted(() => {
  process.env.CONTACT_ACK_EMAIL = 'true';
});

const { configResponseSchema } = await import('@cupidilla/contracts');
const { sql } = await import('drizzle-orm');
const { CONTACT_INBOX, CONTACT_NOW, contactBody, contactRows, LUCIA } =
  await import('./helpers/contact.js');
const { deliverMail, inbox } = await import('./helpers/mail.js');
const { api, createTestApp, resetRateLimits, truncateAll } = await import('./helpers/test-app.js');
type TestApp = Awaited<ReturnType<typeof createTestApp>>;

/** Acuse al remitente (técnico de contacto §4.5, C2), con CONTACT_ACK_EMAIL=true. */
describe('CONTACT_ACK_EMAIL=true', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ now: CONTACT_NOW });
  });
  afterAll(async () => {
    await t.app.close();
    delete process.env.CONTACT_ACK_EMAIL;
  });
  beforeEach(async () => {
    await truncateAll(t.db);
    resetRateLimits(t.app);
    inbox(t.app).clear();
    t.clock.set(CONTACT_NOW);
  });

  it('GET /config dice que el acuse está activado', async () => {
    const response = await api(t.app).get('/config');
    expect(configResponseSchema.parse(response.body).contact).toEqual({ ackEmail: true });
  });

  it('C2: llega además un acuse con la referencia y sin nada de lo escrito', async () => {
    expect((await api(t.app).post('/contact').send(contactBody())).status).toBe(202);
    expect(await deliverMail(t.app)).toMatchObject({ sent: 2 });
    const [row] = await contactRows(t.db);

    const [internal] = inbox(t.app).messagesTo(CONTACT_INBOX);
    expect(internal?.text).toContain('Acuse enviado al remitente: sí');
    expect(row?.ack_requested).toBe(true);

    const acks = inbox(t.app).messagesTo(LUCIA);
    expect(acks).toHaveLength(1);
    const [ack] = acks;
    expect(ack?.subject).toBe('Hemos recibido tu mensaje');
    expect(ack?.replyTo).toBeUndefined();
    expect(ack?.text).toContain(`Referencia: ${row?.id.slice(0, 8)}`);
    expect(ack?.text).toContain(`con este correo (${LUCIA})`);
    for (const written of ['Lucía', 'Duda sobre mi cuenta', 'no me llega']) {
      expect(ack?.text).not.toContain(written);
      expect(ack?.html).not.toContain(written);
    }
    expect(ack?.html).not.toMatch(/href=/);
  });

  it('QA: si el mensaje se recibió sin acuse, el correo interno dice «no» aunque ahora esté activado', async () => {
    expect((await api(t.app).post('/contact').send(contactBody())).status).toBe(202);
    // Simula un mensaje que llegó con CONTACT_ACK_EMAIL=false: sin acuse en el outbox.
    await t.db.execute(sql`update contact_messages set ack_requested = false`);
    await t.db.execute(sql`delete from email_outbox where kind = 'contact_ack'`);
    expect(await deliverMail(t.app)).toMatchObject({ sent: 1 });
    expect(inbox(t.app).messagesTo(CONTACT_INBOX)[0]?.text).toContain(
      'Acuse enviado al remitente: no',
    );
  });

  it('el campo trampa tampoco envía el acuse', async () => {
    const body = contactBody({ hp_contact: 'http://spam.example' });
    expect((await api(t.app).post('/contact').send(body)).status).toBe(202);
    expect(await deliverMail(t.app)).toMatchObject({ sent: 0 });
    expect(inbox(t.app).messages).toEqual([]);
  });
});
