import { solveChallenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptchaReplayStore } from './captcha-replay.store.js';
import { CaptchaService } from './captcha.service.js';

const make = (key: string, store = new CaptchaReplayStore()) =>
  new CaptchaService(store, {
    get: (n: string) =>
      ({
        CAPTCHA_ENABLED: true,
        CAPTCHA_HMAC_KEY: key,
        CAPTCHA_DIFFICULTY: 'minimal',
        NODE_ENV: 'test',
      })[n],
  } as never);
const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');
const KEY_A = 'qa-captcha-key-A-0123456789abcdefghij';
const KEY_B = 'qa-captcha-key-B-0123456789abcdefghij';

async function solved(s: CaptchaService) {
  const challenge = await s.createChallenge();
  return { challenge, solution: (await solveChallenge({ challenge, deriveKey }))! };
}

afterEach(() => vi.useRealTimers());

describe('CaptchaService QA', () => {
  it('un reto firmado con otra clave no vale (signature)', async () => {
    const payload = await solved(make(KEY_A));
    expect(await make(KEY_B).verify(enc(payload))).toEqual({ ok: false, reason: 'signature' });
  });

  it('alargar expiresAt sin la clave invalida la firma', async () => {
    const s = make(KEY_A);
    const p = await solved(s);
    p.challenge.parameters.expiresAt += 3600;
    expect(await s.verify(enc(p))).toEqual({ ok: false, reason: 'signature' });
  });

  it('cambiar el nonce para esquivar el replay invalida la firma', async () => {
    const s = make(KEY_A);
    const p = await solved(s);
    expect((await s.verify(enc(p))).ok).toBe(true);
    p.challenge.parameters.nonce = 'ab'.repeat(8);
    expect(await s.verify(enc(p))).toEqual({ ok: false, reason: 'signature' });
  });

  it('CA21: justo antes de caducar vale; justo después, expired', async () => {
    const s = make(KEY_A);
    const a = await solved(s);
    const b = await solved(s);
    const exp = a.challenge.parameters.expiresAt * 1000;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(exp - 2_000);
    expect((await s.verify(enc(a))).ok).toBe(true);
    vi.setSystemTime(exp + 2_000);
    expect(await s.verify(enc(b))).toEqual({ ok: false, reason: 'expired' });
  });

  it('LIMITACIÓN conocida: dos instancias con la misma clave aceptan la misma solución', async () => {
    const p = await solved(make(KEY_A));
    expect((await make(KEY_A).verify(enc(p))).ok).toBe(true);
    expect((await make(KEY_A).verify(enc(p))).ok).toBe(true);
  });

  it('cabecera con base64 válido pero JSON de otro tipo no lanza', async () => {
    const s = make(KEY_A);
    for (const v of [null, 1, 'x', [], {}, { challenge: 1, solution: 2 }]) {
      expect(await s.verify(enc(v))).toEqual({ ok: false, reason: 'malformed' });
    }
  });
});
