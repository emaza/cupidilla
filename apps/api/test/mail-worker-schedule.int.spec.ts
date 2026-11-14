import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { emailOutbox } from '../src/database/schema/index.js';
import { MailDeliveryError, Mailer, type MailMessage } from '../src/mail/mailer.js';
import { OutboxService } from '../src/mail/outbox.service.js';
import { OUTBOX_INTERVAL_MS, OutboxWorker } from '../src/mail/outbox.worker.js';
import { ANA, BETO, seedAna, seedBeto } from './helpers/mail.js';
import {
  countRows,
  createTestApp,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

/**
 * Un `Mailer` que no es `MemoryMailer`: el *worker* programa sus `drain()` como en producción.
 * Puede fallar el próximo envío o quedarse bloqueado hasta `release()`.
 */
class ControlledMailer extends Mailer {
  readonly sent: MailMessage[] = [];
  failNext = false;
  private gate: Promise<void> | undefined;
  private open: (() => void) | undefined;
  blocked = false;

  block(): void {
    this.gate = new Promise((resolve) => (this.open = resolve));
  }

  release(): void {
    this.open?.();
    this.gate = undefined;
  }

  async send(message: MailMessage): Promise<void> {
    if (this.gate) {
      this.blocked = true;
      await this.gate;
      this.blocked = false;
    }
    if (this.failNext) {
      this.failNext = false;
      throw new MailDeliveryError(false, 'smtp_421');
    }
    this.sent.push(message);
  }
}

/** Espera (tiempo real) a que se cumpla la condición; falla pasado `timeoutMs`. */
async function until(condition: () => boolean | Promise<boolean>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`No se cumplió en ${timeoutMs} ms`);
    await new Promise((done) => setTimeout(done, 20));
  }
}

describe('Programación del worker con un SMTP (correo §4.3)', () => {
  let t: TestApp;
  const mailer = new ControlledMailer();
  let worker: OutboxWorker;
  let outbox: OutboxService;

  beforeAll(async () => {
    t = await createTestApp({
      override: (builder) => builder.overrideProvider(Mailer).useValue(mailer),
    });
    worker = t.app.get(OutboxWorker);
    outbox = t.app.get(OutboxService);
  });
  afterAll(async () => {
    mailer.release();
    await t.app.close();
  });
  beforeEach(async () => {
    // Que no quede ningún drain() en curso de la prueba anterior.
    await until(() => !mailer.blocked, 2000);
    await truncateAll(t.db);
    mailer.sent.length = 0;
    mailer.failNext = false;
    t.clock.set(TEST_NOW);
  });

  it('tras un fallo transitorio a las 10:00:00, el siguiente drain() se programa a las 10:00:30 y lo envía', async () => {
    await seedBeto(t.db);
    await outbox.enqueue(t.db, 'verify_email', BETO);
    mailer.failNext = true;

    expect(await worker.drain()).toMatchObject({ retried: 1 });
    // Tras el drain(): el siguiente, cuando vence la fila (no en el tick de 30 s ni más tarde).
    await until(() => worker.nextDrainAt?.toISOString() === '2026-11-11T10:00:30.000Z', 2000);

    t.clock.set('2026-11-11T10:00:30.000Z');
    expect(await worker.drain()).toMatchObject({ sent: 1 });
    expect(mailer.sent.map((message) => message.to)).toEqual([BETO]);
    expect(await countRows(t.db, 'email_outbox')).toBe(0);
  });

  it('el siguiente drain() va al vencimiento de la primera fila pendiente, entre 1 s y 30 s', async () => {
    await seedBeto(t.db);
    await outbox.enqueue(t.db, 'verify_email', BETO);
    const dueAt = async (iso: string) => {
      await t.db.update(emailOutbox).set({ nextAttemptAt: new Date(iso) });
      await worker.drain();
    };

    await dueAt('2026-11-11T10:00:12.000Z');
    await until(() => worker.nextDrainAt?.toISOString() === '2026-11-11T10:00:12.000Z', 2000);
    // Más allá de 30 s, el tope.
    await dueAt('2026-11-11T10:05:00.000Z');
    await until(() => worker.nextDrainAt?.toISOString() === '2026-11-11T10:00:30.000Z', 2000);
    // Debida pero con la concesión de otra instancia: al vencer la concesión, sin bajar de 1 s.
    await t.db
      .update(emailOutbox)
      .set({ lockedUntil: new Date('2026-11-11T10:00:00.500Z') })
      .where(eq(emailOutbox.toEmail, BETO));
    await dueAt('2026-11-11T09:00:00.000Z');
    await until(() => worker.nextDrainAt?.toISOString() === '2026-11-11T10:00:01.000Z', 2000);
    expect(mailer.sent).toEqual([]);
  });

  it('sin filas pendientes, el siguiente drain() es a los 30 s (el tope)', async () => {
    await worker.drain();
    await until(
      () => worker.nextDrainAt?.getTime() === new Date(TEST_NOW).getTime() + OUTBOX_INTERVAL_MS,
      2000,
    );
  });

  it('un kick() durante un drain() bloqueado en el envío hace que el nuevo correo salga al terminar', async () => {
    await seedAna(t.db);
    await seedBeto(t.db);
    mailer.block();
    await outbox.enqueue(t.db, 'password_changed', ANA);
    outbox.kick();
    await until(() => mailer.blocked, 2000);

    // Llega mientras el drain() espera al SMTP: ese drain() ya no lo verá.
    await outbox.enqueue(t.db, 'password_changed', BETO);
    outbox.kick();
    mailer.release();

    // Sin esperar al siguiente drain() programado (como mínimo 1 s; aquí, 30 s).
    await until(() => mailer.sent.length === 2, 800);
    expect(mailer.sent.map((message) => message.to).sort()).toEqual([ANA, BETO]);
  });
});
