import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UNVERIFIED_ACCOUNT_TTL_DAYS, UNVERIFIED_REMINDER_AFTER_DAYS } from '@cupidilla/contracts';
import { and, gt, isNull, lte, sql } from 'drizzle-orm';
import { Clock } from '../common/clock.js';
import type { Env } from '../config/env.schema.js';
import { DB, type Database } from '../database/database.types.js';
import { emailOutbox, users } from '../database/schema/index.js';
import { Transactions } from '../database/transactions.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Cada cuánto corre el barrido (correo §6.3). */
export const UNVERIFIED_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
/** Cuentas por sentencia de borrado: se repite mientras borre el lote entero. */
export const UNVERIFIED_DELETE_BATCH = 100;

export interface SweepResult {
  deleted: number;
  reminded: number;
}

/**
 * Cuentas sin verificar (correo §6.3): recordatorio el 5.º día (si `EMAIL_UNVERIFIED_REMINDER`) y
 * borrado a los 7. Escribe en `email_outbox` con SQL directo, sin `MailModule` (evita un ciclo):
 * el *worker* recoge los recordatorios en su siguiente ciclo. En `NODE_ENV=test` no arranca su
 * temporizador: los tests llaman a `sweep()` con el reloj falso.
 */
@Injectable()
export class UnverifiedAccountsSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UnverifiedAccountsSweeper.name);
  private readonly reminderEnabled: boolean;
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<SweepResult> | undefined;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly transactions: Transactions,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
  ) {
    this.reminderEnabled = config.get('EMAIL_UNVERIFIED_REMINDER', { infer: true });
  }

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    // Al arrancar y después cada hora.
    void this.sweepSafely();
    this.timer = setInterval(() => void this.sweepSafely(), UNVERIFIED_SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.running?.catch(() => undefined);
  }

  /** Borra las cuentas vencidas y encola los recordatorios que tocan. */
  async sweep(): Promise<SweepResult> {
    const now = this.clock.now();
    const deleted = await this.deleteExpired(now);
    const reminded = this.reminderEnabled ? await this.enqueueReminders(now) : 0;
    if (deleted > 0) this.logger.log({ event: 'unverified_accounts_deleted', count: deleted });
    if (reminded > 0) this.logger.log({ event: 'unverified_reminders_enqueued', count: reminded });
    return { deleted, reminded };
  }

  private async sweepSafely(): Promise<void> {
    if (this.running) return;
    this.running = this.sweep();
    try {
      await this.running;
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      this.logger.warn({
        event: 'unverified_sweep_failed',
        code: typeof code === 'string' ? code : 'internal',
      });
    } finally {
      this.running = undefined;
    }
  }

  /**
   * Borrado a los 7 días, en lotes de 100, con la cascada de siempre y los correos pendientes de
   * esas direcciones. La condición va también fuera de la subconsulta: con READ COMMITTED, el
   * DELETE la vuelve a evaluar sobre la fila bloqueada, así que una cuenta verificada justo antes
   * no se borra.
   */
  private async deleteExpired(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - UNVERIFIED_ACCOUNT_TTL_DAYS * DAY_MS).toISOString();
    let total = 0;
    for (;;) {
      const result = await this.db.execute<{ count: string }>(sql`
        with deleted as (
          delete from ${users}
          where ${users.emailVerifiedAt} is null and ${users.createdAt} <= ${cutoff}
            and ${users.id} in (
              select ${users.id} from ${users}
              where ${users.emailVerifiedAt} is null and ${users.createdAt} <= ${cutoff}
              limit ${UNVERIFIED_DELETE_BATCH}
            )
          returning ${users.email}
        ),
        deleted_mail as (
          delete from ${emailOutbox}
          where ${emailOutbox.toEmail} in (select email from deleted)
        )
        select count(*)::text as count from deleted`);
      const count = Number(result.rows[0]?.count ?? 0);
      total += count;
      if (count < UNVERIFIED_DELETE_BATCH) return total;
    }
  }

  /**
   * Recordatorio el 5.º día, una sola vez por cuenta (`verification_reminded_at`), en la misma
   * transacción que lo marca.
   */
  private enqueueReminders(now: Date): Promise<number> {
    const remindFrom = new Date(now.getTime() - UNVERIFIED_REMINDER_AFTER_DAYS * DAY_MS);
    const deleteFrom = new Date(now.getTime() - UNVERIFIED_ACCOUNT_TTL_DAYS * DAY_MS);
    return this.transactions.run(async (tx) => {
      const due = await tx
        .update(users)
        .set({ verificationRemindedAt: now })
        .where(
          and(
            isNull(users.emailVerifiedAt),
            isNull(users.verificationRemindedAt),
            lte(users.createdAt, remindFrom),
            gt(users.createdAt, deleteFrom),
          ),
        )
        .returning({ email: users.email });
      if (due.length === 0) return 0;
      await tx
        .insert(emailOutbox)
        .values(
          due.map(({ email }) => ({
            kind: 'verify_reminder' as const,
            toEmail: email,
            nextAttemptAt: now,
            createdAt: now,
          })),
        )
        .onConflictDoNothing();
      return due.length;
    });
  }
}
