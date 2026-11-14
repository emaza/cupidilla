import { describe, expect, it } from 'vitest';
import { Mailer, type MailMessage } from '../src/mail/mailer.js';
import { OutboxService } from '../src/mail/outbox.service.js';
import { OutboxWorker } from '../src/mail/outbox.worker.js';
import { ANA, BETO, seedAna, seedBeto } from './helpers/mail.js';
import { createTestApp, truncateAll } from './helpers/test-app.js';

class SlowMailer extends Mailer {
  readonly sent: MailMessage[] = [];
  entered = 0;
  async send(message: MailMessage): Promise<void> {
    this.entered += 1;
    await new Promise((done) => setTimeout(done, 300));
    this.sent.push(message);
  }
}

describe('QA: ciclo de vida del worker con un SMTP', () => {
  it('cerrar la app con un drain() en curso lo espera y no deja temporizadores ni nuevos drain()', async () => {
    const mailer = new SlowMailer();
    const t = await createTestApp({
      override: (builder) => builder.overrideProvider(Mailer).useValue(mailer),
    });
    await truncateAll(t.db);
    await seedAna(t.db);
    await seedBeto(t.db);
    const worker = t.app.get(OutboxWorker);
    const outbox = t.app.get(OutboxService);
    await outbox.enqueue(t.db, 'password_changed', ANA);
    outbox.kick();
    while (mailer.entered === 0) await new Promise((done) => setTimeout(done, 10));
    // kicks repetidos durante el envío: una sola repetición, nunca drains concurrentes.
    await outbox.enqueue(t.db, 'password_changed', BETO);
    for (let i = 0; i < 20; i += 1) outbox.kick();

    const closing = t.app.close();
    await closing;
    expect(worker.nextDrainAt).toBeUndefined();
    const sentAtClose = mailer.sent.length;
    outbox.kick();
    await new Promise((done) => setTimeout(done, 1500));
    expect(worker.nextDrainAt).toBeUndefined();
    expect(mailer.sent.length).toBe(sentAtClose);
    expect(mailer.entered).toBeLessThanOrEqual(2);
    expect(sentAtClose).toBeGreaterThanOrEqual(1);
  });
});
