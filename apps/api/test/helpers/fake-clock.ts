import type { Clock } from '../../src/common/clock.js';

/** Reloj fijo para los tests: se mueve a mano. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(now: Date | string) {
    this.current = new Date(now);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(now: Date | string): void {
    this.current = new Date(now);
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60 * 1000);
  }

  advanceDays(days: number): void {
    this.current = new Date(this.current.getTime() + days * 24 * 60 * 60 * 1000);
  }
}
