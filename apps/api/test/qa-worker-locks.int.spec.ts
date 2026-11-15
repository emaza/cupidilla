import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutboxWorker } from '../src/mail/outbox.worker.js';
import { UnverifiedAccountsSweeper } from '../src/users/unverified-accounts.sweeper.js';
import {
  BETO,
  deliverMail,
  inbox,
  linkTo,
  loginToken,
  registerBeto,
  TEST_PASSWORD,
} from './helpers/mail.js';
import {
  api,
  createTestApp,
  resetRateLimits,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

/** QA: el nuevo orden de bloqueos del worker (usuario, luego fila del outbox) no provoca interbloqueos. */
describe('QA: bloqueos del worker frente a restablecer, verificar, barrer y borrar', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await truncateAll(t.db);
    resetRateLimits(t.app);
    inbox(t.app).clear();
    t.clock.set(TEST_NOW);
    vi.restoreAllMocks();
  });

  it.each([5, 7])(
    'rondas concurrentes con el reloj a %i días: sin 5xx ni interbloqueo',
    async (days) => {
      const sweeper = t.app.get(UnverifiedAccountsSweeper);
      const worker = t.app.get(OutboxWorker);
      const output: string[] = [];
      const capture = (chunk: unknown): boolean => {
        output.push(String(chunk));
        return true;
      };
      for (let round = 0; round < 10; round += 1) {
        await truncateAll(t.db);
        resetRateLimits(t.app);
        inbox(t.app).clear();
        t.clock.set(TEST_NOW);
        const { link } = await registerBeto(t.app, t.db);
        const session = await loginToken(t.app, BETO);
        await api(t.app).post('/auth/password-reset/request').send({ email: BETO });
        await deliverMail(t.app);
        const resetLink = linkTo(t.app, BETO, '/reset-password');
        await api(t.app).post('/auth/password-reset/request').send({ email: BETO });
        t.clock.set(new Date(Date.parse(TEST_NOW) + days * 86_400_000 + 1000).toISOString());

        vi.spyOn(process.stdout, 'write').mockImplementation(capture);
        vi.spyOn(process.stderr, 'write').mockImplementation(capture);
        const results = await Promise.allSettled([
          worker.drain(),
          worker.drain(),
          sweeper.sweep(),
          api(t.app)
            .post('/auth/password-reset')
            .send({ token: resetLink, password: 'otra frase larga nueva' }),
          api(t.app)
            .post('/auth/email-verification')
            .send({ token: link, password: TEST_PASSWORD }),
          api(t.app)
            .post('/users/me/deletion')
            .set('Authorization', `Bearer ${session}`)
            .send({ password: TEST_PASSWORD }),
          api(t.app).post('/auth/password-reset/request').send({ email: BETO }),
        ]);
        vi.restoreAllMocks();
        for (const [i, r] of results.entries()) {
          expect(r.status, `op ${i} ronda ${round}`).toBe('fulfilled');
          if (
            r.status === 'fulfilled' &&
            typeof r.value === 'object' &&
            r.value &&
            'status' in r.value
          ) {
            expect(r.value.status as number, `op ${i} ronda ${round}`).toBeLessThan(500);
          }
        }
        expect(output.join('')).not.toMatch(/deadlock/i);
        output.length = 0;
      }
    },
    120_000,
  );
});
