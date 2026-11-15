import { describe, expect, it } from 'vitest';
import { emailOutbox, users } from '../src/database/schema/index.js';
import { Mailer, type MailMessage } from '../src/mail/mailer.js';
import { OutboxService } from '../src/mail/outbox.service.js';
import { OUTBOX_BATCH, OutboxWorker } from '../src/mail/outbox.worker.js';
import { ANA, BETO, seedAna, seedBeto } from './helpers/mail.js';
import { createTestApp, truncateAll } from './helpers/test-app.js';

class SlowMailer extends Mailer {
  readonly sent: MailMessage[] = [];
  entered = 0;
  readonly enteredTo: string[] = [];
  async send(message: MailMessage): Promise<void> {
    this.entered += 1;
    this.enteredTo.push(message.to);
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
    let closed = false;
    const closeApp = async () => {
      if (closed) return;
      closed = true;
      await t.app.close();
    };
    try {
      await truncateAll(t.db);
      await seedAna(t.db);
      await seedBeto(t.db);
      const worker = t.app.get(OutboxWorker);
      const outbox = t.app.get(OutboxService);
      await outbox.enqueue(t.db, 'password_changed', ANA);
      outbox.kick();
      const deadline = Date.now() + 5000;
      while (mailer.entered === 0) {
        if (Date.now() > deadline) throw new Error('El worker no llegó a enviar en 5 s');
        await new Promise((done) => setTimeout(done, 10));
      }
      // kicks repetidos durante el envío: una sola repetición, nunca drains concurrentes.
      await outbox.enqueue(t.db, 'password_changed', BETO);
      for (let i = 0; i < 20; i += 1) outbox.kick();

      await closeApp();
      expect(worker.nextDrainAt).toBeUndefined();
      const sentAtClose = mailer.sent.length;
      outbox.kick();
      await new Promise((done) => setTimeout(done, 1500));
      expect(worker.nextDrainAt).toBeUndefined();
      expect(mailer.sent.length).toBe(sentAtClose);
      expect(mailer.entered).toBeLessThanOrEqual(2);
      expect(sentAtClose).toBeGreaterThanOrEqual(1);
    } finally {
      await closeApp();
    }
  });

  it('al cerrar la app a mitad de un lote, termina las filas reclamadas y no reclama otro lote', async () => {
    const mailer = new SlowMailer();
    const t = await createTestApp({
      override: (builder) => builder.overrideProvider(Mailer).useValue(mailer),
    });
    let closed = false;
    const closeApp = async () => {
      if (closed) return;
      closed = true;
      await t.app.close();
    };
    try {
      await truncateAll(t.db);
      const worker = t.app.get(OutboxWorker);
      // El drain() del arranque ya ha terminado: con la tabla vacía, el siguiente es a los 30 s.
      const deadlineIdle = Date.now() + 5000;
      while ((worker.nextDrainAt?.getTime() ?? 0) - t.clock.now().getTime() < 1000) {
        if (Date.now() > deadlineIdle) throw new Error('El worker no quedó en reposo en 5 s');
        await new Promise((done) => setTimeout(done, 10));
      }
      const total = OUTBOX_BATCH + 2;
      const addresses = Array.from({ length: total }, (_, i) => `lote${i}@example.com`);
      const createdAt = t.clock.now();
      await t.db.insert(users).values(
        addresses.map((email) => ({
          email,
          passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$prueba',
          birthDate: '1990-05-05',
          createdAt,
          updatedAt: createdAt,
        })),
      );
      // Dos lotes de trabajo (12 filas con lote de 10): tras parar, el segundo no se reclama.
      await t.db.insert(emailOutbox).values(
        addresses.map((toEmail) => ({
          kind: 'password_changed' as const,
          toEmail,
          nextAttemptAt: t.clock.now(),
          createdAt: t.clock.now(),
        })),
      );
      const draining = worker.drain();
      const deadline = Date.now() + 5000;
      while (!mailer.enteredTo.some((to) => to.startsWith('lote'))) {
        if (Date.now() > deadline) throw new Error('El worker no llegó a enviar en 5 s');
        await new Promise((done) => setTimeout(done, 10));
      }
      await closeApp();
      await draining;
      // Solo las filas de este test: el drain() de arranque pudo enviar una fila que dejó el test
      // anterior (la tabla se vacía después de crear la app).
      expect(mailer.enteredTo.filter((to) => to.startsWith('lote'))).toHaveLength(OUTBOX_BATCH);
    } finally {
      await closeApp();
    }
  });
});
