import { describe, expect, it } from 'vitest';
import {
  generateSessionToken,
  hashSessionToken,
  needsRenewal,
  SESSION_TOKEN_PATTERN,
} from './sessions.service.js';

describe('token de sesión', () => {
  it('tiene 256 bits en base64url (43 caracteres) y no se repite', () => {
    const tokens = new Set(Array.from({ length: 100 }, generateSessionToken));
    expect(tokens.size).toBe(100);
    for (const token of tokens) {
      expect(token).toMatch(SESSION_TOKEN_PATTERN);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    }
  });

  it('se guarda como SHA-256 en hexadecimal', () => {
    expect(hashSessionToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashSessionToken(generateSessionToken())).toMatch(/^[0-9a-f]{64}$/);
  });
});

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
