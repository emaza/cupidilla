import { randomBytes } from 'node:crypto';
import { randomInt, solveChallenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAPTCHA_DIFFICULTIES } from './captcha-difficulty.js';
import { CaptchaReplayStore } from './captcha-replay.store.js';
import { CaptchaService, deriveCaptchaSecret } from './captcha.service.js';

const KEY = 'test-captcha-hmac-key-0123456789abcdef';
const config = (values: Record<string, unknown>) => ({ get: (name: string) => values[name] });
const service = (store = new CaptchaReplayStore()) =>
  new CaptchaService(
    store,
    config({
      CAPTCHA_ENABLED: true,
      CAPTCHA_HMAC_KEY: KEY,
      CAPTCHA_DIFFICULTY: 'minimal',
      NODE_ENV: 'test',
    }) as never,
  );
const encode = (payload: unknown) => Buffer.from(JSON.stringify(payload)).toString('base64');

async function solved(captcha: CaptchaService) {
  const challenge = await captcha.createChallenge();
  const solution = await solveChallenge({ challenge, deriveKey });
  return { challenge, solution: solution! };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('dificultades y secretos (T4)', () => {
  it('randomInt(max, min) da valores dentro de [counterMin, counterMax]', () => {
    for (const { counterMin, counterMax } of Object.values(CAPTCHA_DIFFICULTIES)) {
      for (let i = 0; i < 10_000; i += 1) {
        const value = randomInt(counterMax, counterMin);
        expect(value).toBeGreaterThanOrEqual(counterMin);
        expect(value).toBeLessThanOrEqual(counterMax);
      }
    }
  });

  it('los dos secretos derivados son distintos entre sí y de la clave', () => {
    const a = deriveCaptchaSecret(KEY, 'challenge');
    const b = deriveCaptchaSecret(KEY, 'key');
    expect(new Set([a, b, KEY]).size).toBe(3);
  });
});

describe('CaptchaService.verify (T4)', () => {
  it('da cada motivo con una entrada hecha a mano', async () => {
    const captcha = service();
    const ok = await solved(captcha);
    expect(await captcha.verify(undefined)).toEqual({ ok: false, reason: 'missing' });
    expect(await captcha.verify('')).toEqual({ ok: false, reason: 'missing' });
    expect(await captcha.verify('no es base64!')).toEqual({ ok: false, reason: 'malformed' });
    const badSignature = {
      ...ok,
      challenge: { ...ok.challenge, signature: 'ab'.repeat(32) },
    };
    expect(await captcha.verify(encode(badSignature))).toEqual({ ok: false, reason: 'signature' });
    const badSolution = { ...ok, solution: { ...ok.solution, derivedKey: 'ab'.repeat(32) } };
    expect(await captcha.verify(encode(badSolution))).toEqual({ ok: false, reason: 'solution' });
    expect(await captcha.verify(encode(ok))).toEqual({ ok: true });
    expect(await captcha.verify(encode(ok))).toEqual({ ok: false, reason: 'replayed' });
    const later = await solved(captcha);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 601_000);
    expect(await captcha.verify(encode(later))).toEqual({ ok: false, reason: 'expired' });
  });

  it('una solución falsa no ocupa sitio en el almacén', async () => {
    const store = new CaptchaReplayStore();
    const captcha = service(store);
    const ok = await solved(captcha);
    await captcha.verify(encode({ ...ok, solution: { ...ok.solution, derivedKey: 'ab' } }));
    expect(store.size).toBe(0);
  });

  it('nunca lanza (1 000 cadenas al azar)', async () => {
    const captcha = service();
    for (let i = 0; i < 1000; i += 1) {
      const bytes = randomBytes(1 + (i % 200));
      const input = i % 2 ? bytes.toString('base64') : bytes.toString('latin1');
      const verdict = await captcha.verify(input);
      expect(verdict.ok).toBe(false);
    }
  });
});

describe('CaptchaReplayStore (T4)', () => {
  it('markUsed da true y después false', () => {
    const store = new CaptchaReplayStore();
    const expires = Date.now() + 60_000;
    expect(store.markUsed('n1', expires)).toBe(true);
    expect(store.markUsed('n1', expires)).toBe(false);
  });

  it('las entradas caducadas se limpian', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const store = new CaptchaReplayStore();
    store.markUsed('viejo', Date.now() + 1000);
    vi.setSystemTime(Date.now() + 120_000);
    store.markUsed('nuevo', Date.now() + 60_000);
    expect(store.size).toBe(1);
  });

  it('con el tope, se borra la más antigua y hay un solo log por minuto', () => {
    const store = new CaptchaReplayStore();
    store.max = 2;
    const warn = vi
      .spyOn((store as unknown as { logger: { warn: (value: unknown) => void } }).logger, 'warn')
      .mockImplementation(() => undefined);
    const expires = Date.now() + 600_000;
    for (const nonce of ['a', 'b', 'c', 'd']) store.markUsed(nonce, expires);
    expect(store.size).toBe(2);
    expect(store.markUsed('a', expires)).toBe(true);
    expect(store.markUsed('d', expires)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({ event: 'captcha_replay_store_full' });
  });
});
