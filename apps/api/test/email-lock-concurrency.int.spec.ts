import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { lockEmail } from '../src/database/email-lock.js';
import { identities, users } from '../src/database/schema/index.js';
import { Transactions } from '../src/database/transactions.js';
import { IdentitiesService } from '../src/oauth/identities.service.js';
import {
  api,
  countRows,
  createTestApp,
  registerBody,
  registerUser,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

/** Espera a que `waiters` sesiones estén bloqueadas esperando un advisory lock. */
async function waitForAdvisoryWaiter(t: TestApp, waiters = 1): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    const result = await t.db.execute<{ count: string }>(
      sql`select count(*)::text as count from pg_locks where locktype = 'advisory' and not granted`,
    );
    if (Number(result.rows[0]?.count) >= waiters) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Nadie esperó el bloqueo del correo');
}

/**
 * R7b, concurrencia real (sin bloqueos tomados a mano): un alta con contraseña y una escritura de
 * `provider_email` del mismo correo, a la vez, no pueden ganar las dos ni quedarse bloqueadas.
 */
describe('Carrera real alta con contraseña vs. identidad con el mismo correo (R7b)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await truncateAll(t.db);
    t.clock.set(TEST_NOW);
  });

  it('exactamente uno gana, sin deadlock, en 20 rondas', async () => {
    const owner = await registerUser(t.app, { email: 'fenix@example.com' });
    const service = t.app.get(IdentitiesService);

    for (let round = 0; round < 20; round += 1) {
      const email = `ronda${round}@example.com`;
      const [registration, creation] = await Promise.all([
        api(t.app)
          .post('/auth/register')
          .send(registerBody({ email: email.toUpperCase() })),
        service
          .createForConnect(owner.userId, {
            provider: round % 2 === 0 ? 'google' : 'facebook',
            subject: `sub-${round}`,
            providerEmail: email,
            emailVerified: true,
          })
          .then(
            (outcome) => outcome,
            (error: unknown) => error,
          ),
      ]);
      // El alta nunca devuelve 500; la identidad puede chocar con la UNIQUE (owner, provider).
      expect([201, 409]).toContain(registration.status);
      if (registration.status === 201 && creation === 'created') {
        throw new Error(`Ronda ${round}: ganaron las dos (cuenta e identidad con ${email})`);
      }
      if (round >= 2) {
        // Con la UNIQUE (user, provider) ya ocupada la identidad falla siempre: se limpia.
        await t.db.delete(identities);
      }
    }
    expect(await countRows(t.db, 'users')).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('touch con otro correo no se bloquea con un alta simultánea de ese correo', async () => {
    const owner = await registerUser(t.app, { email: 'fenix@example.com' });
    const service = t.app.get(IdentitiesService);
    await t.db.insert(identities).values({
      userId: owner.userId,
      provider: 'google',
      subject: 'g-1',
      providerEmail: 'viejo@example.com',
      emailVerified: true,
      createdAt: t.clock.now(),
      lastUsedAt: t.clock.now(),
    });
    const known = await service.findByProviderSubject('google', 'g-1');
    const [registration] = await Promise.all([
      api(t.app)
        .post('/auth/register')
        .send(registerBody({ email: 'nuevo@example.com' })),
      service.touch(known!.id, { providerEmail: 'nuevo@example.com', emailVerified: true }),
    ]);
    expect([201, 409]).toContain(registration.status);
  });

  it('7 (decisión 21): la unión espera al alta en curso de ese correo y se rechaza', async () => {
    const owner = await registerUser(t.app, { email: 'fenix@example.com' });
    const service = t.app.get(IdentitiesService);
    let connect: Promise<'created' | 'email_in_other_account'> | undefined;

    await t.app.get(Transactions).run(async (tx) => {
      // Alta de y@gmail.com en curso: tiene el bloqueo del correo y su fila aún no es visible.
      await lockEmail(tx, 'y@gmail.com');
      connect = service.createForConnect(owner.userId, {
        provider: 'google',
        subject: 'google-y',
        providerEmail: 'y@gmail.com',
        emailVerified: true,
      });
      await waitForAdvisoryWaiter(t);
      await tx.insert(users).values({
        email: 'y@gmail.com',
        passwordHash: null,
        birthDate: '1990-05-05',
        createdAt: t.clock.now(),
        updatedAt: t.clock.now(),
      });
    });

    expect(await connect!).toBe('email_in_other_account');
    expect(await countRows(t.db, 'identities')).toBe(0);
    expect(await countRows(t.db, 'users')).toBe(2);
  });

  it('7, al revés: si la unión llega primero, el alta de ese correo espera y da EMAIL_TAKEN', async () => {
    const owner = await registerUser(t.app, { email: 'fenix@example.com' });
    const service = t.app.get(IdentitiesService);
    let connect: Promise<'created' | 'email_in_other_account'> | undefined;
    let registration: Promise<{ status: number; body: { error?: { code: string } } }> | undefined;

    // Se retiene el bloqueo del correo para fijar el orden de llegada: primero la unión y después
    // el alta. PostgreSQL concede el bloqueo en ese orden al soltarlo.
    await t.app.get(Transactions).run(async (tx) => {
      await lockEmail(tx, 'y@gmail.com');
      connect = service.createForConnect(owner.userId, {
        provider: 'google',
        subject: 'google-y',
        providerEmail: 'y@gmail.com',
        emailVerified: true,
      });
      await waitForAdvisoryWaiter(t, 1);
      registration = api(t.app)
        .post('/auth/register')
        .send(registerBody({ email: 'y@gmail.com' }))
        .then((response) => response);
      await waitForAdvisoryWaiter(t, 2);
    });

    expect(await connect!).toBe('created');
    const response = await registration!;
    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe('EMAIL_TAKEN');
    expect(await countRows(t.db, 'users')).toBe(1);
    expect(await countRows(t.db, 'identities')).toBe(1);
  });
});
