import { Injectable } from '@nestjs/common';
import { Clock } from '../common/clock.js';
import type { Executor } from '../database/database.types.js';
import { emailOutbox } from '../database/schema/index.js';
import { OutboxWorker } from './outbox.worker.js';

export type MailKind = (typeof emailOutbox.kind.enumValues)[number];

/**
 * Encolar correos (correo §4.2). Quien envía llama a `enqueue` dentro de su transacción y, tras
 * el COMMIT, a `kick()`: si la transacción se deshace, no hay correo; si el SMTP está caído, la
 * respuesta HTTP no se entera.
 */
@Injectable()
export class OutboxService {
  constructor(
    private readonly clock: Clock,
    private readonly worker: OutboxWorker,
  ) {}

  /**
   * Una fila «manda este tipo de correo a esta dirección», sin secretos ni `user_id`. Si ya hay
   * una pendiente del mismo tipo para la misma dirección, no hace nada (`email_outbox_pending_unique`).
   */
  async enqueue(db: Executor, kind: MailKind, toEmail: string): Promise<void> {
    const now = this.clock.now();
    await db
      .insert(emailOutbox)
      .values({ kind, toEmail, nextAttemptAt: now, createdAt: now })
      .onConflictDoNothing();
  }

  /** Tras el COMMIT: envía en cuanto pueda, sin esperar. Con `MemoryMailer` no hace nada. */
  kick(): void {
    this.worker.kick();
  }
}
