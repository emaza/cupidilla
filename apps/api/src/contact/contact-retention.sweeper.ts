import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { CONTACT_MESSAGE_RETENTION_DAYS } from '@cupidilla/contracts';
import { sql } from 'drizzle-orm';
import { Clock } from '../common/clock.js';
import { DB, type Database } from '../database/database.types.js';
import { contactMessages } from '../database/schema/index.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Cada cuánto corre el barrido (técnico de contacto §9). */
export const CONTACT_RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
/** Mensajes por sentencia de borrado: se repite mientras borre el lote entero. */
export const CONTACT_RETENTION_BATCH = 500;

/**
 * Retención de `contact_messages` (técnico de contacto §9): borra los mensajes de más de 180 días.
 * Sus filas del *outbox* caen en cascada. En `NODE_ENV=test` no arranca su temporizador: los
 * tests llaman a `sweep()` con el reloj falso.
 */
@Injectable()
export class ContactRetentionSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ContactRetentionSweeper.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<number> | undefined;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    // Al arrancar y después cada hora.
    void this.sweepSafely();
    this.timer = setInterval(() => void this.sweepSafely(), CONTACT_RETENTION_SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.running?.catch(() => undefined);
  }

  /** Borra los mensajes vencidos, en lotes de 500. Devuelve cuántos. */
  async sweep(): Promise<number> {
    const cutoff = new Date(
      this.clock.now().getTime() - CONTACT_MESSAGE_RETENTION_DAYS * DAY_MS,
    ).toISOString();
    let total = 0;
    for (;;) {
      const result = await this.db.execute<{ count: string }>(sql`
        with deleted as (
          delete from ${contactMessages}
          where ${contactMessages.id} in (
            select ${contactMessages.id} from ${contactMessages}
            where ${contactMessages.createdAt} <= ${cutoff}
            limit ${CONTACT_RETENTION_BATCH}
          )
          returning 1
        )
        select count(*)::text as count from deleted`);
      const count = Number(result.rows[0]?.count ?? 0);
      total += count;
      if (count < CONTACT_RETENTION_BATCH) break;
    }
    if (total > 0) this.logger.log({ event: 'contact_messages_deleted', count: total });
    return total;
  }

  private async sweepSafely(): Promise<void> {
    if (this.running) return;
    this.running = this.sweep();
    try {
      await this.running;
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      this.logger.warn({
        event: 'contact_retention_sweep_failed',
        code: typeof code === 'string' ? code : 'internal',
      });
    } finally {
      this.running = undefined;
    }
  }
}
