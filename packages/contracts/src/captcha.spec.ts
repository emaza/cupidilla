import { describe, expect, it } from 'vitest';
import { captchaChallengeSchema, captchaPayloadSchema } from './captcha.js';

/** Un reto real, copiado de `createChallenge` de altcha-lib 2.8.0 (dificultad mínima). */
const challenge = {
  parameters: {
    algorithm: 'PBKDF2/SHA-256',
    cost: 1,
    expiresAt: 1795400000,
    keyLength: 32,
    keyPrefix: '7a2b2d910c3c31574a030dca2ef04a4d',
    keySignature: '36765996cc0ba43ab5f7a246748052505e23acd1efd4a6e8b3488448b2185b44',
    nonce: 'ffb99d6ec00436dd55f71e8d4d4c6b90',
    salt: '5b1396dc5bb74a2d50ad0ca75ee4d974',
  },
  signature: 'ef34333f5b9129ffa110c2b00bedf49cff124468710e2753a0d85827f69e8bfd',
};
const solution = {
  counter: 8,
  derivedKey: '7a2b2d910c3c31574a030dca2ef04a4d89b032e11e253b36a4c5d5bf89f09e0a',
  time: 1.6,
};

describe('captchaChallengeSchema (técnico de captcha §4.2, T1)', () => {
  it('un reto real pasa', () => {
    expect(captchaChallengeSchema.parse(challenge)).toEqual(challenge);
  });

  it.each([
    ['codeChallenge', { ...challenge, codeChallenge: { image: 'data:image/png;base64,AA' } }],
    ['configuration', { ...challenge, configuration: { auto: 'onload' } }],
    ['data', { ...challenge, parameters: { ...challenge.parameters, data: { a: 1 } } }],
    ['SHA-256', { ...challenge, parameters: { ...challenge.parameters, algorithm: 'SHA-256' } }],
    ['sin firma', { parameters: challenge.parameters }],
    ['firma en mayúsculas', { ...challenge, signature: challenge.signature.toUpperCase() }],
  ])('con %s, falla', (_name, input) => {
    expect(captchaChallengeSchema.safeParse(input).success).toBe(false);
  });
});

describe('captchaPayloadSchema', () => {
  it('una solución real pasa', () => {
    expect(captchaPayloadSchema.parse({ challenge, solution })).toEqual({ challenge, solution });
  });

  it('la carga de prueba del widget falla', () => {
    expect(
      captchaPayloadSchema.safeParse({ challenge: null, solution: null, test: true }).success,
    ).toBe(false);
  });

  it('un derivedKey en mayúsculas falla', () => {
    const upper = { ...solution, derivedKey: solution.derivedKey.toUpperCase() };
    expect(captchaPayloadSchema.safeParse({ challenge, solution: upper }).success).toBe(false);
  });

  it('una carga de la v1 falla', () => {
    const v1 = { algorithm: 'SHA-256', challenge: 'ab', number: 1, salt: 'cd', signature: 'ef' };
    expect(captchaPayloadSchema.safeParse(v1).success).toBe(false);
  });
});
