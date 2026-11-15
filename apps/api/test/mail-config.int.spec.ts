import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Mailer } from '../src/mail/mailer.js';
import { MemoryMailer } from '../src/mail/memory.mailer.js';
import { OUTBOX_INTERVAL_MS, OutboxWorker } from '../src/mail/outbox.worker.js';
import { createTestApp, type TestApp } from './helpers/test-app.js';

describe('A1-2: NODE_ENV=test sin SMTP_URL (correo §8.1, §11.1)', () => {
  let t: TestApp;
  const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    setIntervalSpy.mockRestore();
    await t.app.close();
  });

  it('el Mailer inyectado es MemoryMailer y el worker no programa ningún temporizador', () => {
    expect(process.env.NODE_ENV).toBe('test');
    // vitest.config.ts la deja vacía, que cuenta como ausente.
    expect(process.env.SMTP_URL ?? '').toBe('');
    expect(t.app.get(Mailer)).toBeInstanceOf(MemoryMailer);
    expect(setIntervalSpy.mock.calls.some(([, delay]) => delay === OUTBOX_INTERVAL_MS)).toBe(false);
    // Ni el drain() del arranque ni el siguiente: los tests llaman a drain() a mano.
    expect(t.app.get(OutboxWorker).nextDrainAt).toBeUndefined();
  });
});
