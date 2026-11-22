import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptchaReplayStore } from './captcha-replay.store.js';

/** Retos usados en memoria (técnico de captcha §4.5, T4). */
describe('CaptchaReplayStore', () => {
  const NOW = new Date('2026-11-22T10:00:00.000Z').getTime();
  let store: CaptchaReplayStore;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    store = new CaptchaReplayStore();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('markUsed da true la primera vez y false después', () => {
    expect(store.markUsed('a', NOW + 600_000)).toBe(true);
    expect(store.markUsed('a', NOW + 600_000)).toBe(false);
    expect(store.markUsed('b', NOW + 600_000)).toBe(true);
  });

  it('un nonce caducado vale otra vez (el reto ya no lo aceptaría) y las entradas caducadas se limpian', () => {
    store.markUsed('a', NOW + 1_000);
    store.markUsed('b', NOW + 600_000);
    vi.setSystemTime(NOW + 61_000);
    expect(store.markUsed('c', NOW + 600_000)).toBe(true);
    // La limpieza (como mucho una vez por minuto) ha borrado «a».
    expect(store.size).toBe(2);
    expect(store.markUsed('a', NOW + 700_000)).toBe(true);
  });

  it('con el tope, borra la más antigua y avisa una sola vez por minuto', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    store.max = 3;
    for (const nonce of ['a', 'b', 'c', 'd', 'e']) store.markUsed(nonce, NOW + 600_000);
    expect(store.size).toBe(3);
    // «a» y «b» se han borrado: valen otra vez. «e» sigue.
    expect(store.markUsed('e', NOW + 600_000)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({ event: 'captcha_replay_store_full' });

    vi.setSystemTime(NOW + 30_000);
    store.markUsed('f', NOW + 600_000);
    expect(warn).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + 61_000);
    store.markUsed('g', NOW + 600_000);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('clear() lo vacía', () => {
    store.markUsed('a', NOW + 600_000);
    store.clear();
    expect(store.markUsed('a', NOW + 600_000)).toBe(true);
  });
});
