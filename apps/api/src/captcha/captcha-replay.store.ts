import { Injectable, Logger } from '@nestjs/common';

/** Entradas como mucho (unos 10 MB): llegar aquí es resolver 100 000 retos en 10 minutos (R-CA4). */
export const CAPTCHA_REPLAY_MAX = 100_000;
const MINUTE_MS = 60_000;

/**
 * Retos ya usados, en memoria, hasta que caducan (técnico de captcha §4.5). Comprobar y apuntar
 * van en la misma llamada síncrona: dos envíos simultáneos de la misma solución no pueden pasar
 * los dos. Sin temporizador: la limpieza va dentro de `markUsed`, como mucho una vez por minuto.
 *
 * Usa `Date.now()` y no `Clock`, como `CaptchaService` (§4.4): las caducidades son las del reto.
 */
@Injectable()
export class CaptchaReplayStore {
  private readonly logger = new Logger(CaptchaReplayStore.name);
  /** `nonce` → caducidad en ms. El `Map` conserva el orden de inserción. */
  private readonly used = new Map<string, number>();
  private lastSweepAt = 0;
  private lastFullLogAt = Number.NEGATIVE_INFINITY;
  /** Tope de entradas. Solo los tests lo bajan. */
  max = CAPTCHA_REPLAY_MAX;

  /** `true` la primera vez; `false` si ese nonce ya se usó y no ha caducado. */
  markUsed(nonce: string, expiresAtMs: number): boolean {
    const now = Date.now();
    this.sweep(now);
    const previous = this.used.get(nonce);
    if (previous !== undefined && previous > now) return false;
    if (previous !== undefined) this.used.delete(nonce);
    if (this.used.size >= this.max) {
      // Todas caducan a los 10 minutos de su reto: la primera es la más antigua.
      const oldest = this.used.keys().next().value;
      if (oldest !== undefined) this.used.delete(oldest);
      if (now - this.lastFullLogAt >= MINUTE_MS) {
        this.lastFullLogAt = now;
        this.logger.warn({ event: 'captcha_replay_store_full' });
      }
    }
    this.used.set(nonce, expiresAtMs);
    return true;
  }

  /** Solo para los tests (como `resetRateLimits`). */
  clear(): void {
    this.used.clear();
    this.lastSweepAt = 0;
    this.lastFullLogAt = Number.NEGATIVE_INFINITY;
  }

  /** Para los tests. */
  get size(): number {
    return this.used.size;
  }

  private sweep(now: number): void {
    if (now - this.lastSweepAt < MINUTE_MS) return;
    this.lastSweepAt = now;
    for (const [nonce, expiresAtMs] of this.used) {
      if (expiresAtMs <= now) this.used.delete(nonce);
    }
  }
}
