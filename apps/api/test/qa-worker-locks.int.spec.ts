import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { users } from '../src/database/schema/index.js';
import { MailResolver } from '../src/mail/mail-resolver.js';
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

const DAY_MS = 86_400_000;

/**
 * Compuerta en el resolver: el worker llega a `resolve()` con la fila del usuario y la de su
 * correo ya bloqueadas (outbox.worker.ts) y se queda ahí hasta `release()`. `reached` avisa de que
 * el worker tiene ambos bloqueos; solo se frena la primera llamada.
 */
function gateWorker(t: TestApp): { reached: Promise<void>; release: () => void } {
  const resolver = t.app.get(MailResolver);
  const resolve = resolver.resolve.bind(resolver);
  let reachedFn!: () => void;
  const reached = new Promise<void>((done) => (reachedFn = done));
  let release!: () => void;
  const gate = new Promise<void>((done) => (release = done));
  let first = true;
  vi.spyOn(resolver, 'resolve').mockImplementation(async (...args) => {
    if (first) {
      first = false;
      reachedFn();
      await gate;
    }
    return resolve(...args);
  });
  return { reached, release };
}

/** Espera a que `reached` ocurra, sin colgar la prueba si el worker nunca llega. */
async function within<T>(promise: Promise<T>, what: string, ms = 15_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tiempo agotado esperando: ${what}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Espera a que haya `count` sentencias `SELECT … FOR UPDATE` sobre `users` bloqueadas esperando un
 * bloqueo de fila (`pg_stat_activity.wait_event_type = 'Lock'`): prueba de que la transacción de
 * restablecer y la de verificar han llegado de verdad a su bloqueo de la cuenta, detrás del worker.
 * Sondea la condición (no un tiempo fijo) y se rinde a los 15 s.
 */
async function waitForUserLockWaiters(t: TestApp, count: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const result = await t.db.execute<{ n: number }>(sql`
      select count(*)::int as n from pg_stat_activity
      where datname = current_database() and pid <> pg_backend_pid()
        and wait_event_type = 'Lock'
        and (
          (query ilike '%from "users"%' and query ilike '%for update%')
          or query ilike '%delete from "users"%'
          or query ilike '%update "users" set%'
        )`);
    if ((result.rows[0]?.n ?? 0) >= count) return;
    if (Date.now() > deadline) throw new Error(`Menos de ${count} esperas sobre la cuenta`);
    await new Promise((wake) => setTimeout(wake, 10));
  }
}

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

  it('con ambos enlaces vigentes, restablecer y verificar esperan a la cuenta bloqueada por el worker y acaban con un resultado coherente', async () => {
    const worker = t.app.get(OutboxWorker);
    const { link } = await registerBeto(t.app, t.db);
    await api(t.app).post('/auth/password-reset/request').send({ email: BETO });
    await deliverMail(t.app);
    const resetLink = linkTo(t.app, BETO, '/reset-password');
    await api(t.app).post('/auth/password-reset/request').send({ email: BETO });

    const output: string[] = [];
    const capture = (chunk: unknown): boolean => {
      output.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(capture);
    vi.spyOn(process.stderr, 'write').mockImplementation(capture);
    const { reached, release } = gateWorker(t);
    try {
      const draining = worker.drain();
      await within(reached, 'el worker con la cuenta bloqueada');
      const resetting = api(t.app)
        .post('/auth/password-reset')
        .send({ token: resetLink, password: 'otra frase larga nueva' })
        .then((response) => response);
      const verifying = api(t.app)
        .post('/auth/email-verification')
        .send({ token: link, password: TEST_PASSWORD })
        .then((response) => response);
      await within(waitForUserLockWaiters(t, 2), 'restablecer y verificar bloqueados');
      // Mientras el worker sigue dentro, ninguna de las dos ha terminado.
      release();
      const drained = await draining;
      const reset = await resetting;
      const verify = await verifying;
      vi.restoreAllMocks();
      // El worker emitió un enlace nuevo (anula el anterior): restablecer con el viejo es inválido.
      expect(drained.sent).toBe(1);
      expect(reset.status).toBe(400);
      expect(reset.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');
      // El enlace de verificación no es del worker: verificar sale bien y abre sesión.
      expect(verify.status).toBe(200);
      expect(verify.body.session).toBe('opened');
      expect(output.join('')).not.toMatch(/deadlock/i);
    } finally {
      release();
      vi.restoreAllMocks();
    }
  }, 120_000);

  it.each([5, 7])(
    'con enlaces vigentes y la cuenta con %i días, el barrido (5: recuerda, 7: borra), restablecer y verificar esperan al worker y se ordenan sin 5xx ni interbloqueo',
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
        const { userId, link } = await registerBeto(t.app, t.db);
        await api(t.app).post('/auth/password-reset/request').send({ email: BETO });
        await deliverMail(t.app);
        const resetLink = linkTo(t.app, BETO, '/reset-password');
        await api(t.app).post('/auth/password-reset/request').send({ email: BETO });
        // El reloj no se mueve: los tokens (`expires_at`) siguen vigentes. Solo se envejece la
        // cuenta para que el barrido recuerde (5 días) o borre (7 días, `created_at <= corte`).
        const aged = new Date(Date.parse(TEST_NOW) - days * DAY_MS - 1000);
        await t.db
          .update(users)
          .set({ createdAt: aged, updatedAt: aged })
          .where(eq(users.id, userId));

        vi.spyOn(process.stdout, 'write').mockImplementation(capture);
        vi.spyOn(process.stderr, 'write').mockImplementation(capture);
        const { reached, release } = gateWorker(t);
        try {
          const draining = worker.drain();
          await within(reached, `worker con la cuenta bloqueada (ronda ${round})`);
          // Primero el barrido: su DELETE/UPDATE de la fila queda esperando al worker. Los bloqueos
          // de fila se conceden por orden de llegada, y restablecer y verificar tardan en llegar
          // (argon2 antes de su transacción), así que entran después.
          const sweeping = sweeper.sweep();
          await within(waitForUserLockWaiters(t, 1), `barrido bloqueado (ronda ${round})`);
          const resetting = api(t.app)
            .post('/auth/password-reset')
            .send({ token: resetLink, password: 'otra frase larga nueva' })
            .then((response) => response);
          const verifying = api(t.app)
            .post('/auth/email-verification')
            .send({ token: link, password: TEST_PASSWORD })
            .then((response) => response);
          await within(
            waitForUserLockWaiters(t, 3),
            `tres esperas sobre la cuenta (ronda ${round})`,
          );
          release();
          const [drained, swept, reset, verify] = await Promise.all([
            draining,
            sweeping,
            resetting,
            verifying,
          ]);
          vi.restoreAllMocks();
          expect(drained.sent, `worker ronda ${round}`).toBe(1);
          // El worker renovó el enlace de restablecer (o el barrido borró la cuenta): nunca 200.
          expect(reset.status, `restablecer ronda ${round}`).toBe(400);
          if (days === 5) {
            expect(swept, `barrido ronda ${round}`).toEqual({ deleted: 0, reminded: 1 });
            expect(verify.status, `verificar ronda ${round}`).toBe(200);
          } else {
            expect(swept, `barrido ronda ${round}`).toEqual({ deleted: 1, reminded: 0 });
            expect(verify.status, `verificar ronda ${round}`).toBe(400);
            expect(verify.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');
            expect(await t.db.select().from(users)).toEqual([]);
          }
          expect(output.join('')).not.toMatch(/deadlock/i);
          output.length = 0;
        } finally {
          release();
          vi.restoreAllMocks();
        }
      }
    },
    120_000,
  );
});
