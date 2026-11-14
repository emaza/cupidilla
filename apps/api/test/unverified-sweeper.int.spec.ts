import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { emailOutbox, users } from '../src/database/schema/index.js';
import { UnverifiedAccountsSweeper } from '../src/users/unverified-accounts.sweeper.js';
import {
  ANA,
  BETO,
  deliverMail,
  inbox,
  linkTo,
  loginToken,
  registerBeto,
  seedAna,
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

/** B.5: recordatorio y borrado de cuentas sin verificar (correo §6.3). */
describe('B.5: UnverifiedAccountsSweeper', () => {
  let t: TestApp;
  let sweeper: UnverifiedAccountsSweeper;

  beforeAll(async () => {
    t = await createTestApp();
    sweeper = t.app.get(UnverifiedAccountsSweeper);
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await truncateAll(t.db);
    resetRateLimits(t.app);
    inbox(t.app).clear();
    t.clock.set(TEST_NOW);
  });

  const beto = async () => (await t.db.select().from(users).where(eq(users.email, BETO)))[0];
  const inspect = (token: string) =>
    api(t.app).post('/auth/email-tokens/inspection').send({ token, purpose: 'verify_email' });

  it('B5-1: el recordatorio sale el 5.º día, con la fecha de borrado y un enlace nuevo', async () => {
    const { link } = await registerBeto(t.app, t.db);
    t.clock.set('2026-11-16T09:59:00Z');
    expect(await sweeper.sweep()).toEqual({ deleted: 0, reminded: 0 });

    t.clock.set('2026-11-16T10:00:00Z');
    expect(await sweeper.sweep()).toEqual({ deleted: 0, reminded: 1 });
    expect((await beto())?.verificationRemindedAt?.toISOString()).toBe('2026-11-16T10:00:00.000Z');
    const [row] = await t.db.select().from(emailOutbox);
    expect(row).toMatchObject({ kind: 'verify_reminder', toEmail: BETO });

    await deliverMail(t.app);
    const reminder = inbox(t.app).messagesTo(BETO).at(-1);
    expect(reminder?.subject).toBe('Confirma tu correo o borraremos tu cuenta');
    expect(reminder?.text).toContain('18 de noviembre de 2026');
    const fresh = linkTo(t.app, BETO, '/verify-email');
    expect(fresh).not.toBe(link);
    expect((await inspect(link)).body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');
    expect((await inspect(fresh)).status).toBe(200);
  });

  it('B5-2: no se encola un segundo recordatorio', async () => {
    await registerBeto(t.app, t.db);
    t.clock.set('2026-11-16T10:00:00Z');
    await sweeper.sweep();
    await deliverMail(t.app);
    t.clock.set('2026-11-16T11:00:00Z');
    expect(await sweeper.sweep()).toEqual({ deleted: 0, reminded: 0 });
    expect(await t.db.select().from(emailOutbox)).toEqual([]);
  });

  it('B5-4: se borra a los 7 días, sin rastro en las tablas con FK, y Ana sigue', async () => {
    await seedAna(t.db);
    const { userId } = await registerBeto(t.app, t.db);
    await loginToken(t.app, BETO);
    t.clock.set('2026-11-18T09:59:00Z');
    expect((await sweeper.sweep()).deleted).toBe(0);
    expect(await beto()).toBeDefined();

    t.clock.set('2026-11-18T10:01:00Z');
    expect((await sweeper.sweep()).deleted).toBe(1);
    expect(await beto()).toBeUndefined();
    const referencing = await t.db.execute<{ table_name: string; column_name: string }>(sql`
      select kcu.table_name, kcu.column_name
      from information_schema.referential_constraints rc
      join information_schema.key_column_usage kcu on kcu.constraint_name = rc.constraint_name
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = rc.constraint_name
      where ccu.table_name = 'users'`);
    expect(referencing.rows.length).toBeGreaterThan(0);
    for (const { table_name, column_name } of referencing.rows) {
      const result = await t.db.execute<{ count: string }>(
        sql`select count(*)::text as count from ${sql.identifier(table_name)} where ${sql.identifier(column_name)} = ${userId}`,
      );
      expect(Number(result.rows[0]?.count), table_name).toBe(0);
    }
    expect(await t.db.select().from(users).where(eq(users.email, ANA))).toHaveLength(1);
  });

  it('B5-5: 150 cuentas sin verificar de hace 8 días se borran todas', async () => {
    const createdAt = new Date('2026-11-03T10:00:00Z');
    await t.db.insert(users).values(
      Array.from({ length: 150 }, (_, i) => ({
        email: `vieja${i}@example.com`,
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$prueba',
        birthDate: '1990-05-05',
        createdAt,
        updatedAt: createdAt,
      })),
    );
    expect((await sweeper.sweep()).deleted).toBe(150);
    expect(await t.db.select().from(users)).toEqual([]);
  });

  it('B5-6: en orden, borrar y después confirmar da 400; confirmar y después barrer conserva la cuenta', async () => {
    const first = await registerBeto(t.app, t.db);
    t.clock.set('2026-11-18T10:00:00Z');
    await sweeper.sweep();
    const late = await api(t.app)
      .post('/auth/email-verification')
      .send({ token: first.link, password: TEST_PASSWORD });
    expect(late.status).toBe(400);
    expect(late.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');

    t.clock.set(TEST_NOW);
    inbox(t.app).clear();
    const second = await registerBeto(t.app, t.db);
    t.clock.set('2026-11-12T09:00:00Z');
    const inTime = await api(t.app)
      .post('/auth/email-verification')
      .send({ token: second.link, password: TEST_PASSWORD });
    expect(inTime.status).toBe(200);
    t.clock.set('2026-11-18T10:01:00Z');
    expect((await sweeper.sweep()).deleted).toBe(0);
    expect((await beto())?.emailVerifiedAt).not.toBeNull();
  });

  it('B5-6: confirmación y borrado a la vez: o verificada y sigue, o borrada y la confirmación da 400', async () => {
    const outcomes = new Set<string>();
    for (let round = 0; round < 6; round += 1) {
      await truncateAll(t.db);
      resetRateLimits(t.app);
      inbox(t.app).clear();
      t.clock.set(TEST_NOW);
      await registerBeto(t.app, t.db);
      // Un enlace nuevo el 6.º día, que sigue vivo cuando vence la cuenta.
      t.clock.set('2026-11-17T12:00:00Z');
      await api(t.app).post('/auth/email-verification/request').send({ email: BETO });
      await deliverMail(t.app);
      const link = linkTo(t.app, BETO, '/verify-email');
      t.clock.set('2026-11-18T10:00:00Z');
      const confirm = () =>
        api(t.app).post('/auth/email-verification').send({ token: link, password: TEST_PASSWORD });
      // Se alternan los dos órdenes de salida.
      const [confirmation] =
        round % 2 === 0
          ? await Promise.all([confirm(), sweeper.sweep()])
          : await Promise.all([sweeper.sweep().then(() => undefined), confirm()]).then(
              ([, response]) => [response],
            );
      const row = await beto();
      if (row) {
        expect(row.emailVerifiedAt, `ronda ${round}`).not.toBeNull();
        expect(confirmation?.status, `ronda ${round}`).toBe(200);
        outcomes.add('verificada');
      } else {
        outcomes.add('borrada');
        expect(confirmation?.status, `ronda ${round}`).toBe(400);
        expect(confirmation?.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');
      }
    }
    // Ninguna ronda acaba a medias (ni 500 por interbloqueo): solo los dos resultados válidos.
    expect([...outcomes].every((outcome) => ['verificada', 'borrada'].includes(outcome))).toBe(
      true,
    );
  });
});
