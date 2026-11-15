import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { consents, emailOutbox, users } from '../src/database/schema/index.js';
import { PasswordService } from '../src/users/password.service.js';
import {
  ANA,
  BETO,
  CARLA_FB,
  deliverMail,
  inbox,
  mailRegisterBody,
  NADIE,
  registerBeto,
  seedAna,
  seedCarla,
} from './helpers/mail.js';
import {
  api,
  countRows,
  createTestApp,
  registerUser,
  resetRateLimits,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

/** Cabeceras que no dependen del momento de la respuesta. */
const stableHeaders = (headers: Record<string, string>) =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => name !== 'date'));

/** B.2: registro uniforme (correo §5.1, §5.2). */
describe('B.2: registro uniforme', () => {
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

  const userRow = async (email: string) =>
    (await t.db.select().from(users).where(eq(users.email, email)))[0];

  it('B2-1: Nadie se registra → 202 sin cuerpo, cuenta sin verificar, consentimiento y ningún correo hasta drain()', async () => {
    const response = await api(t.app).post('/auth/register').send(mailRegisterBody(NADIE));
    expect(response.status).toBe(202);
    expect(response.text).toBe('');

    const row = await userRow(NADIE);
    expect(row?.emailVerifiedAt).toBeNull();
    const [consent] = await t.db.select().from(consents).where(eq(consents.userId, row!.id));
    expect(consent?.grantedAt.toISOString()).toBe(TEST_NOW);
    expect(await countRows(t.db, 'sessions')).toBe(0);

    await deliverMail(t.app);
    const messages = inbox(t.app).messagesTo(NADIE);
    expect(messages.map((message) => message.subject)).toEqual(['Confirma tu correo']);
  });

  it('B2-2 y B2-3: Nadie, Ana, Beto y carla.fb reciben la misma respuesta; nada cambia y cada uno recibe su correo', async () => {
    await registerUser(t.app, { email: ANA });
    await registerBeto(t.app, t.db);
    await seedCarla(t.db);
    inbox(t.app).clear();
    const before = await t.db.select().from(users).orderBy(users.email);
    // Los cubos por correo empiezan igual para los cuatro: así las cabeceras son comparables.
    resetRateLimits(t.app);

    const hash = vi.spyOn(t.app.get(PasswordService), 'hash');
    const responses = [];
    for (const email of [NADIE, ANA, BETO, CARLA_FB]) {
      const outboxBefore = await countRows(t.db, 'email_outbox');
      const response = await api(t.app).post('/auth/register').send(mailRegisterBody(email));
      responses.push(response);
      expect(await countRows(t.db, 'email_outbox'), email).toBe(outboxBefore + 1);
    }
    expect(hash).toHaveBeenCalledTimes(4);

    const [first, ...rest] = responses;
    for (const response of rest) {
      expect(response.status).toBe(202);
      expect(response.text).toBe('');
      expect(stableHeaders(response.headers)).toEqual(stableHeaders(first!.headers));
    }
    expect(first?.status).toBe(202);

    const after = await t.db.select().from(users).orderBy(users.email);
    expect(after.filter((row) => row.email !== NADIE)).toEqual(before);

    // B2-3
    await deliverMail(t.app);
    const subjectOf = (email: string) =>
      inbox(t.app)
        .messagesTo(email)
        .map((message) => message.subject);
    const headingOf = (email: string) => inbox(t.app).messagesTo(email)[0]?.text.split('\n')[0];
    expect(subjectOf(NADIE)).toEqual(['Confirma tu correo']);
    expect(subjectOf(ANA)).toEqual(['Alguien ha intentado registrarse con tu correo']);
    expect(headingOf(ANA)).toBe('Ya tienes una cuenta en Cupidilla');
    expect(headingOf(BETO)).toBe('Hay una cuenta sin confirmar con tu correo');
    expect(headingOf(CARLA_FB)).toBe('Tu correo ya está unido a una cuenta');
  });

  it('B2-5: el 4.º registro con el mismo correo en 24 h → 429 con Retry-After, exista o no; otro correo pasa', async () => {
    await seedAna(t.db);
    for (const ip of ['10.0.0.1', '10.0.0.2', '10.0.0.3']) {
      expect((await api(t.app, ip).post('/auth/register').send(mailRegisterBody(ANA))).status).toBe(
        202,
      );
    }
    const blocked = await api(t.app, '10.0.0.4').post('/auth/register').send(mailRegisterBody(ANA));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    for (const ip of ['10.0.1.1', '10.0.1.2', '10.0.1.3']) {
      expect(
        (await api(t.app, ip).post('/auth/register').send(mailRegisterBody(NADIE))).status,
      ).toBe(202);
    }
    const nadie = await api(t.app, '10.0.1.4').post('/auth/register').send(mailRegisterBody(NADIE));
    expect(nadie.status).toBe(429);
    expect(nadie.body).toEqual(blocked.body);

    const other = await api(t.app, '10.0.0.4')
      .post('/auth/register')
      .send(mailRegisterBody('nadie2@example.com'));
    expect(other.status).toBe(202);
  });

  it('B2-6: un menor con el correo de Ana → 422 UNDERAGE y ninguna fila nueva en el outbox', async () => {
    await registerUser(t.app, { email: ANA });
    const before = await countRows(t.db, 'email_outbox');
    const response = await api(t.app)
      .post('/auth/register')
      .send(mailRegisterBody(ANA, { birthDate: '2008-11-12' }));
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('UNDERAGE');
    expect(await countRows(t.db, 'email_outbox')).toBe(before);
    expect(await t.db.select().from(emailOutbox)).toEqual([]);
  });

  it('B2-7: registerUser deja la cuenta verificada con una sesión; con verified: false, sin verificar', async () => {
    const verified = await registerUser(t.app);
    const session = await api(t.app)
      .get('/auth/session')
      .set('Authorization', `Bearer ${verified.token}`);
    expect(session.body.user.emailVerified).toBe(true);

    const unverified = await registerUser(t.app, {}, { verified: false });
    const other = await api(t.app)
      .get('/auth/session')
      .set('Authorization', `Bearer ${unverified.token}`);
    expect(other.status).toBe(200);
    expect(other.body.user.emailVerified).toBe(false);
  });
});
