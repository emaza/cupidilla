import { describe, expect, it } from 'vitest';
import { needsRenewal } from './sessions.service.js';

describe('renovación de la sesión', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = new Date('2026-11-11T10:00:00.000Z');
  const inDays = (days: number) => new Date(now.getTime() + days * DAY_MS);

  it('se renueva cuando queda menos de la mitad del TTL', () => {
    expect(needsRenewal(inDays(14), now, 30 * DAY_MS)).toBe(true);
    expect(needsRenewal(inDays(15), now, 30 * DAY_MS)).toBe(false);
    expect(needsRenewal(inDays(16), now, 30 * DAY_MS)).toBe(false);
  });

  it('con un TTL corto no escribe en cada petición', () => {
    const ttl = 7 * DAY_MS;
    expect(needsRenewal(inDays(7), now, ttl)).toBe(false);
    expect(needsRenewal(inDays(4), now, ttl)).toBe(false);
    expect(needsRenewal(inDays(3), now, ttl)).toBe(true);
  });
});
