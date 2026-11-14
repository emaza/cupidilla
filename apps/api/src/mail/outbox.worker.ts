import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { and, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { Clock } from '../common/clock.js';
import { DB, type Database } from '../database/database.types.js';
import { emailOutbox } from '../database/schema/index.js';
import { Transactions } from '../database/transactions.js';
import { EmailTokensService } from './email-tokens.service.js';
import { MailResolver } from './mail-resolver.js';
import { MailDeliveryError, Mailer } from './mailer.js';
import { MemoryMailer } from './memory.mailer.js';
import type { MailKind } from './outbox.service.js';

/** Espera máxima entre dos `drain()` sin que nadie avise (correo §4.3). */
export const OUTBOX_INTERVAL_MS = 30_000;
/** Espera mínima entre dos `drain()` programados: evita un bucle si una fila debida no se puede reclamar. */
export const OUTBOX_MIN_DELAY_MS = 1000;
/** Concesión de una fila reclamada: si la API muere a mitad de envío, otra la recupera. */
export const OUTBOX_LEASE_MS = 2 * 60_000;
/** Filas por reclamación. */
export const OUTBOX_BATCH = 10;
/** Espera tras el intento n (1.º → 30 s … 7.º → 4 h); el 8.º fallo marca `failed_at` (~8 h). */
export const OUTBOX_RETRY_DELAYS_MS = [
  30_000,
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
  60 * 60_000,
  2 * 60 * 60_000,
  4 * 60 * 60_000,
] as const;
export const OUTBOX_MAX_ATTEMPTS = OUTBOX_RETRY_DELAYS_MS.length + 1;
/** Las filas fallidas se guardan 7 días para diagnosticar (correo §3.5). */
export const OUTBOX_FAILED_RETENTION_MS = 7 * 24 * 60 * 60_000;
/** Las limpiezas van en el mismo ciclo, como mucho una vez por minuto. */
const CLEANUP_INTERVAL_MS = 60_000;

export interface DrainResult {
  sent: number;
  skipped: number;
  retried: number;
  failed: number;
}

type ClaimedRow = {
  id: string;
  kind: MailKind;
  to_email: string;
  attempts: number;
};

/**
 * Envía el *outbox* (correo §4.3) dentro de la API: un `drain()` al arrancar y con cada `kick()`.
 * Tras cada `drain()` programa el siguiente para cuando venza la primera fila pendiente, entre
 * 1 s y 30 s después; un `kick()` durante un `drain()` hace que se drene otra vez al terminar.
 * Con `MemoryMailer` no programa nada: los tests llaman a `drain()` a mano.
 * Varias instancias pueden convivir: cada fila se reclama con `FOR UPDATE SKIP LOCKED` y una
 * concesión de 2 minutos.
 */
@Injectable()
export class OutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorker.name);
  private readonly automatic: boolean;
  private timer: NodeJS.Timeout | undefined;
  /** Instante (del `Clock`) del próximo `drain()` programado. */
  private nextAt: Date | undefined;
  /** Hubo un `kick()` durante un `drain()`: hay trabajo que ese `drain()` no vio. */
  private rerun = false;
  /** `scheduleNext` está consultando cuándo vence la próxima fila. */
  private planning = false;
  private readonly inFlight = new Set<Promise<DrainResult>>();
  private lastCleanupAt: number | undefined;
  private stopping = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly transactions: Transactions,
    private readonly clock: Clock,
    private readonly mailer: Mailer,
    private readonly resolver: MailResolver,
    private readonly tokens: EmailTokensService,
  ) {
    this.automatic = !(mailer instanceof MemoryMailer);
  }

  onModuleInit(): void {
    if (this.automatic) this.scheduleIn(0);
  }

  /** Al parar, espera al `drain()` en curso. */
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.clearTimer();
    await Promise.allSettled([...this.inFlight]);
  }

  /** Instante del próximo `drain()` programado; `undefined` si no hay ninguno (o con `MemoryMailer`). */
  get nextDrainAt(): Date | undefined {
    return this.nextAt;
  }

  /**
   * Drena en cuanto pueda, sin esperar. Si ya hay un `drain()` en curso, se repite al terminar:
   * la fila recién encolada puede no haberla visto. Con `MemoryMailer` no hace nada.
   */
  kick(): void {
    if (!this.automatic || this.stopping) return;
    // Con un drain() en curso o calculando el siguiente, lo resuelve `scheduleNext` al acabar.
    if (this.inFlight.size > 0 || this.planning) {
      this.rerun = true;
      return;
    }
    this.scheduleIn(0);
  }

  /** Reclama y envía todo lo que toca ahora. No lanza: los fallos se registran. */
  drain(): Promise<DrainResult> {
    const run = this.drainOnce().finally(() => {
      this.inFlight.delete(run);
      if (this.automatic) void this.scheduleNext();
    });
    this.inFlight.add(run);
    return run;
  }

  private clearTimer(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.nextAt = undefined;
  }

  /** Un único `drain()` programado: el nuevo sustituye al anterior. */
  private scheduleIn(delayMs: number): void {
    if (this.stopping) return;
    this.clearTimer();
    this.nextAt = new Date(this.clock.now().getTime() + delayMs);
    const fire = () => {
      this.timer = undefined;
      this.nextAt = undefined;
      if (this.stopping) return;
      if (this.inFlight.size > 0) {
        this.rerun = true;
        return;
      }
      void this.drain();
    };
    this.timer = setTimeout(fire, delayMs);
    this.timer.unref();
  }

  /**
   * Tras un `drain()`: otra vez en el acto si hubo un `kick()` mientras tanto; si no, cuando venza
   * la primera fila pendiente, entre 1 s y 30 s después (los 30 s son el tope sin avisos).
   */
  private async scheduleNext(): Promise<void> {
    if (this.stopping || this.inFlight.size > 0) return;
    if (this.rerun) {
      this.rerun = false;
      this.scheduleIn(0);
      return;
    }
    let delay = OUTBOX_INTERVAL_MS;
    this.planning = true;
    try {
      const result = await this.db.execute<{ due_ms: number | null }>(sql`
        select (extract(epoch from min(greatest(next_attempt_at, coalesce(locked_until, next_attempt_at)))) * 1000)::float8 as due_ms
        from email_outbox
        where failed_at is null and attempts < ${OUTBOX_MAX_ATTEMPTS}`);
      const due = result.rows[0]?.due_ms;
      if (due !== null && due !== undefined) {
        const wait = Number(due) - this.clock.now().getTime();
        delay = Math.min(OUTBOX_INTERVAL_MS, Math.max(OUTBOX_MIN_DELAY_MS, wait));
      }
    } catch (error) {
      this.logger.warn({ event: 'mail_drain_failed', code: errorCode(error) });
    } finally {
      this.planning = false;
    }
    // Un `kick()` o un `drain()` llegados durante la consulta mandan.
    if (this.stopping || this.inFlight.size > 0) return;
    if (this.rerun) {
      this.rerun = false;
      delay = 0;
    }
    this.scheduleIn(delay);
  }

  private async drainOnce(): Promise<DrainResult> {
    const result: DrainResult = { sent: 0, skipped: 0, retried: 0, failed: 0 };
    try {
      await this.cleanup();
      for (;;) {
        const rows = await this.claim();
        for (const row of rows) result[await this.process(row)] += 1;
        if (rows.length < OUTBOX_BATCH) break;
      }
    } catch (error) {
      this.logger.warn({ event: 'mail_drain_failed', code: errorCode(error) });
    }
    return result;
  }

  /** Reclama hasta 10 filas debidas: concesión de 2 min y un intento más (correo §4.3). */
  private async claim(): Promise<ClaimedRow[]> {
    const now = this.clock.now();
    const leaseUntil = new Date(now.getTime() + OUTBOX_LEASE_MS);
    const claimed = await this.db.execute<ClaimedRow>(sql`
      update email_outbox
      set locked_until = ${leaseUntil.toISOString()}, attempts = attempts + 1
      where id in (
        select id from email_outbox
        where failed_at is null
          and next_attempt_at <= ${now.toISOString()}
          and (locked_until is null or locked_until <= ${now.toISOString()})
          and attempts < ${OUTBOX_MAX_ATTEMPTS}
        order by next_attempt_at
        limit ${OUTBOX_BATCH}
        for update skip locked
      )
      returning id, kind, to_email, attempts`);
    return claimed.rows;
  }

  private async process(row: ClaimedRow): Promise<keyof DrainResult> {
    try {
      // Resolver y emitir el token se confirman antes de enviar: el token en claro solo existe
      // en memoria y en el correo. Si el envío falla, ese token no lo tiene nadie.
      const message = await this.transactions.run(async (tx) => {
        const resolved = await this.resolver.resolve(tx, row.kind, row.to_email);
        if (!resolved) await tx.delete(emailOutbox).where(eq(emailOutbox.id, row.id));
        return resolved;
      });
      if (!message) {
        this.logger.log({ event: 'mail_skipped', kind: row.kind });
        return 'skipped';
      }
      await this.mailer.send(message);
      await this.db.delete(emailOutbox).where(eq(emailOutbox.id, row.id));
      this.logger.log({ event: 'mail_sent', kind: row.kind, attempt: row.attempts });
      return 'sent';
    } catch (error) {
      return this.recordFailure(row, error);
    }
  }

  private async recordFailure(row: ClaimedRow, error: unknown): Promise<keyof DrainResult> {
    const delivery = error instanceof MailDeliveryError ? error : undefined;
    const code = (delivery?.code ?? errorCode(error)).slice(0, 64);
    const now = this.clock.now();
    const delay = OUTBOX_RETRY_DELAYS_MS[row.attempts - 1];
    try {
      if (delivery?.permanent || delay === undefined) {
        await this.db
          .update(emailOutbox)
          .set({ failedAt: now, lockedUntil: null, lastError: code })
          .where(eq(emailOutbox.id, row.id));
        this.logger.error({ event: 'mail_failed', kind: row.kind, code, attempt: row.attempts });
        return 'failed';
      }
      await this.db
        .update(emailOutbox)
        .set({
          nextAttemptAt: new Date(now.getTime() + delay),
          lockedUntil: null,
          lastError: code,
        })
        .where(eq(emailOutbox.id, row.id));
      this.logger.warn({ event: 'mail_retry', kind: row.kind, code, attempt: row.attempts });
      return 'retried';
    } catch (updateError) {
      // La concesión vence en 2 min y la fila se vuelve a intentar.
      this.logger.warn({ event: 'mail_drain_failed', code: errorCode(updateError) });
      return 'retried';
    }
  }

  /**
   * Limpiezas (correo §3.5, §4.3), como mucho una vez por minuto: tokens caducados, filas
   * fallidas de más de 7 días y filas que agotaron sus intentos con la concesión vencida (la API
   * murió durante el último).
   */
  private async cleanup(): Promise<void> {
    const now = this.clock.now();
    const last = this.lastCleanupAt;
    if (last !== undefined && now.getTime() >= last && now.getTime() - last < CLEANUP_INTERVAL_MS) {
      return;
    }
    this.lastCleanupAt = now.getTime();
    await this.tokens.deleteExpired(this.db);
    await this.db
      .delete(emailOutbox)
      .where(
        and(
          isNotNull(emailOutbox.failedAt),
          lte(emailOutbox.failedAt, new Date(now.getTime() - OUTBOX_FAILED_RETENTION_MS)),
        ),
      );
    await this.db.execute(sql`
      update email_outbox set failed_at = ${now.toISOString()}, locked_until = null,
        last_error = 'attempts_exhausted'
      where failed_at is null and attempts >= ${OUTBOX_MAX_ATTEMPTS}
        and locked_until <= ${now.toISOString()}`);
  }
}

/** Solo un código para los logs y `last_error`: nunca el mensaje (puede llevar direcciones). */
function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(code) ? code : 'internal';
}
