import { describe, expect, it } from 'vitest';
import { generateOpaqueToken, hashOpaqueToken, OPAQUE_TOKEN_PATTERN } from './opaque-token.js';

describe('token opaco', () => {
  it('tiene 256 bits en base64url (43 caracteres) y no se repite', () => {
    const tokens = new Set(Array.from({ length: 100 }, generateOpaqueToken));
    expect(tokens.size).toBe(100);
    for (const token of tokens) {
      expect(token).toMatch(OPAQUE_TOKEN_PATTERN);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    }
  });

  it('se guarda como SHA-256 en hexadecimal', () => {
    expect(hashOpaqueToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashOpaqueToken(generateOpaqueToken())).toMatch(/^[0-9a-f]{64}$/);
  });
});
