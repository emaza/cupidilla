import { describe, expect, it } from 'vitest';
import { emailOutbox, users } from '../src/database/schema/index.js';
import { Mailer, type MailMessage } from '../src/mail/mailer.js';
import { OutboxService } from '../src/mail/outbox.service.js';
import { OUTBOX_BATCH, OutboxWorker } from '../src/mail/outbox.worker.js';
import { ANA, BETO, seedAna, seedBeto } from './helpers/mail.js';
import { createTestApp, truncateAll } from './helpers/test-app.js';

/**
 * `send()` con señales explícitas: avisa de cada entrada y espera a `release()` (que deja pasar
 * este y todos los envíos siguientes). Sin esperas fijas.
 */
class GatedMailer extends Mailer {
  readonly sent: MailMessage[] = [];
  entered = 0;
  readonly enteredTo: string[] = [];
  private enteredWaiters: Array<() => void> = [];
  private open!: () => void;
  private readonly gate = new Promise<void>((resolve) => (this.open = resolve));

  /** `blocks` elige los destinatarios cuyo envío espera a `release()`; los demás pasan. */
  constructor(private readonly blocks: (to: string) => boolean = () => true) {
    super();
  }

  async send(message: MailMessage): Promise<void> {
    this.entered += 1;
    this.enteredTo.push(message.to);
    for (const wake of this.enteredWaiters.splice(0)) wake();
    if (this.blocks(message.to)) await this.gate;
    this.sent.push(message);
  }

  release(): void {
    this.open();
  }

  /** Espera (acotada) a que haya entrado algún envío que cumpla `match`. */
  async waitEntered(match: (to: string) => boolean = () => true, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!this.enteredTo.some(match)) {
      if (Date.now() > deadline) throw new Error(`Ningún envío entró en ${timeoutMs} ms`);
      await new Promise<void>((wake) => {
        this.enteredWaiters.push(wake);
        setTimeout(wake, 50);
      });
    }
  }
}

/** Empieza a cerrar la app con el envío bloqueado y espera a que el worker sepa que se para. */
async function startClosing(
  close: () => Promise<void>,
  worker: OutboxWorker,
): Promise<{ closing: Promise<void> }> {
  const closing = close();
  const state = worker as unknown as { stopping: boolean };
  const deadline = Date.now() + 5000;
  while (!state.stopping) {
    if (Date.now() > deadline) throw new Error('El worker no empezó a parar en 5 s');
    await new Promise((done) => setTimeout(done, 5));
  }
  // En un objeto: devuelta tal cual, el `await` de quien llama la esperaría (y el cierre espera al envío).
  return { closing };
}

describe('QA: ciclo de vida del worker con un SMTP', () => {
  it('cerrar la app con un drain() en curso lo espera y no deja temporizadores ni nuevos drain()', async () => {
    const mailer = new GatedMailer();
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
      await mailer.waitEntered();
      // kicks repetidos durante el envío: una sola repetición, nunca drains concurrentes.
      await outbox.enqueue(t.db, 'password_changed', BETO);
      for (let i = 0; i < 20; i += 1) outbox.kick();

      // El cierre empieza con el envío bloqueado y se libera después: lo espera.
      const { closing } = await startClosing(closeApp, worker);
      mailer.release();
      await closing;
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
    const mailer = new GatedMailer((to) => to.startsWith('lote'));
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
      await mailer.waitEntered((to) => to.startsWith('lote'));
      const { closing } = await startClosing(closeApp, worker);
      mailer.release();
      await closing;
      await draining;
      // Solo las filas de este test: el drain() de arranque pudo enviar una fila que dejó el test
      // anterior (la tabla se vacía después de crear la app).
      expect(mailer.enteredTo.filter((to) => to.startsWith('lote'))).toHaveLength(OUTBOX_BATCH);
    } finally {
      await closeApp();
    }
  });
});
