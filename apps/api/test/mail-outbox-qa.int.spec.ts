import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { emailOutbox } from '../src/database/schema/index.js';
import { OutboxService } from '../src/mail/outbox.service.js';
import { OUTBOX_MAX_ATTEMPTS } from '../src/mail/outbox.worker.js';
import { BETO, deliverMail, inbox, seedBeto } from './helpers/mail.js';
import { createTestApp, truncateAll, type TestApp } from './helpers/test-app.js';

/** QA de la fase A: la API muere durante el último intento (correo §4.3). */
describe('QA A.4: intentos agotados con la API caída', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await truncateAll(t.db);
    inbox(t.app).clear();
    t.clock.set('2027-01-01T08:00:00.000Z');
  });

  const rowOf = async () =>
    (await t.db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, BETO)))[0];

  it('el 8.º intento con la concesión vencida (la API murió) acaba marcado como fallido, sin enviar', async () => {
    await seedBeto(t.db);
    await t.app.get(OutboxService).enqueue(t.db, 'verify_email', BETO);
    await t.db
      .update(emailOutbox)
      .set({ attempts: OUTBOX_MAX_ATTEMPTS, lockedUntil: new Date('2027-01-01T07:59:00.000Z') })
      .where(eq(emailOutbox.toEmail, BETO));

    await deliverMail(t.app);
    expect(inbox(t.app).messages).toEqual([]);
    const row = await rowOf();
    expect(row?.failedAt).toEqual(t.clock.now());
    expect(row?.lockedUntil).toBeNull();
    expect(row?.lastError).toBe('attempts_exhausted');
  });

  it('con la concesión del 8.º intento aún vigente, no se toca', async () => {
    await seedBeto(t.db);
    await t.app.get(OutboxService).enqueue(t.db, 'verify_email', BETO);
    await t.db
      .update(emailOutbox)
      .set({ attempts: OUTBOX_MAX_ATTEMPTS, lockedUntil: new Date('2027-01-01T08:01:00.000Z') })
      .where(eq(emailOutbox.toEmail, BETO));

    await deliverMail(t.app);
    const row = await rowOf();
    expect(row?.failedAt).toBeNull();
  });
});
