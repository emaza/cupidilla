import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionsService } from '../src/auth/sessions.service.js';
import { emailOutbox, emailTokens, identities, users } from '../src/database/schema/index.js';
import { UsersService } from '../src/users/users.service.js';
import {
  ANA,
  BETO,
  CARLA,
  CARLA_FB,
  deliverMail,
  inbox,
  linkTo,
  loginToken,
  NADIE,
  registerBeto,
  seedCarla,
  TEST_PASSWORD,
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

const NEW_PASSWORD = 'otra frase larga nueva';

/** C.2: pedir la recuperación y restablecer la contraseña (correo §5.5, §5.6). */
describe('C.2: recuperación de la contraseña', () => {
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

  const requestReset = (email: string, ip?: string) =>
    api(t.app, ip).post('/auth/password-reset/request').send({ email });
  const reset = (token: string, password = NEW_PASSWORD) =>
    api(t.app).post('/auth/password-reset').send({ token, password });
  const inspect = (token: string) =>
    api(t.app).post('/auth/email-tokens/inspection').send({ token, purpose: 'reset_password' });
  const sessionStatus = async (token: string) =>
    (await api(t.app).get('/auth/session').set('Authorization', `Bearer ${token}`)).status;
  const login = (email: string, password: string) =>
    api(t.app).post('/auth/login').send({ email, password });
  const userRow = async (email: string) =>
    (await t.db.select().from(users).where(eq(users.email, email)))[0];
  const ana = () => registerUser(t.app, { email: ANA, password: TEST_PASSWORD });

  /** Pide la recuperación, entrega el correo y devuelve el token del enlace. */
  async function resetLink(email: string): Promise<string> {
    expect((await requestReset(email)).status).toBe(202);
    await deliverMail(t.app);
    return linkTo(t.app, email, '/reset-password');
  }

  it('C2-1: Ana y Nadie → 202 idénticos, una fila cada una, sin consultar users; solo Ana recibe el correo', async () => {
    await ana();
    inbox(t.app).clear();
    const usersService = t.app.get(UsersService);
    const spies = Object.getOwnPropertyNames(UsersService.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => vi.spyOn(usersService, name as keyof UsersService));

    const forAna = await requestReset(ANA);
    expect(await countRows(t.db, 'email_outbox')).toBe(1);
    const forNadie = await requestReset(NADIE);
    expect(await countRows(t.db, 'email_outbox')).toBe(2);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();

    for (const response of [forAna, forNadie]) {
      expect(response.status).toBe(202);
      expect(response.text).toBe('');
    }
    const headers = (response: typeof forAna) =>
      Object.fromEntries(Object.entries(response.headers).filter(([name]) => name !== 'date'));
    expect(headers(forNadie)).toEqual(headers(forAna));

    vi.restoreAllMocks();
    await deliverMail(t.app);
    expect(inbox(t.app).messages.map((m) => [m.to, m.subject])).toEqual([
      [ANA, 'Restablece tu contraseña'],
    ]);
  });

  it('C2-2: restablecer cierra las 3 sesiones de Ana, no la de Beto, y abre una nueva', async () => {
    const first = (await ana()).token;
    const others = [await loginToken(t.app, ANA), await loginToken(t.app, ANA)];
    await registerBeto(t.app, t.db);
    const beto = await loginToken(t.app, BETO);
    const link = await resetLink(ANA);

    const response = await reset(link);
    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      email: ANA,
      emailVerified: true,
      dataReviewRequired: false,
    });
    expect((await login(ANA, TEST_PASSWORD)).status).toBe(401);
    expect((await login(ANA, NEW_PASSWORD)).status).toBe(200);
    for (const token of [first, ...others]) expect(await sessionStatus(token)).toBe(401);
    expect(await sessionStatus(beto)).toBe(200);
    expect(await sessionStatus(response.body.session.token as string)).toBe(200);

    const anaId = (await userRow(ANA))!.id;
    expect(await t.db.select().from(emailTokens).where(eq(emailTokens.userId, anaId))).toEqual([]);
    const pendingResets = await t.db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.kind, 'reset_password'));
    expect(pendingResets).toEqual([]);
  });

  it('C2-2: borra un correo de recuperación pendiente para esa dirección (traería otro enlace válido)', async () => {
    await ana();
    const link = await resetLink(ANA);
    expect((await requestReset(ANA)).status).toBe(202);
    expect(await countRows(t.db, 'email_outbox')).toBe(1);
    expect((await reset(link)).status).toBe(200);
    expect(
      await t.db.select().from(emailOutbox).where(eq(emailOutbox.kind, 'reset_password')),
    ).toEqual([]);
  });

  it('C2-3: con EMAIL_PASSWORD_CHANGED_NOTICE sin definir, Ana recibe «Tu contraseña ha cambiado»', async () => {
    await ana();
    const link = await resetLink(ANA);
    inbox(t.app).clear();
    expect((await reset(link)).status).toBe(200);
    await deliverMail(t.app);
    const messages = inbox(t.app).messagesTo(ANA);
    expect(messages.map((m) => m.subject)).toEqual(['Tu contraseña ha cambiado']);
    expect(messages[0]!.text).not.toMatch(/token=/);
  });

  it('C2-3b: Beto restablece y no hace la revisión: el aviso sale igual (encolado en el restablecimiento)', async () => {
    await registerBeto(t.app, t.db);
    const link = await resetLink(BETO);
    inbox(t.app).clear();
    const response = await reset(link);
    expect(response.status).toBe(200);
    expect(response.body.user.dataReviewRequired).toBe(true);
    // Sin ninguna petición más (cierra el navegador): el correo ya está en el outbox.
    await deliverMail(t.app);
    expect(
      inbox(t.app)
        .messagesTo(BETO)
        .map((m) => m.subject),
    ).toEqual(['Tu contraseña ha cambiado']);
  });

  it('C2-4: Carla (solo Google) crea su contraseña por correo, entra con ella y conserva Google', async () => {
    const carlaId = await seedCarla(t.db);
    const link = await resetLink(CARLA);
    expect((await reset(link)).status).toBe(200);
    expect((await login(CARLA, NEW_PASSWORD)).status).toBe(200);
    const linked = await t.db.select().from(identities).where(eq(identities.userId, carlaId));
    expect(linked.map((row) => row.provider).sort()).toEqual(['facebook', 'google']);
    expect((await userRow(CARLA))?.dataReviewRequiredAt).toBeNull();
  });

  it('C2-5: el correo de un proveedor (carla.fb) → 202 y ningún correo', async () => {
    await seedCarla(t.db);
    expect((await requestReset(CARLA_FB)).status).toBe(202);
    await deliverMail(t.app);
    expect(inbox(t.app).messages).toEqual([]);
  });

  it('C2-6: un enlace emitido a las 10:00 vale a las 10:59 y no a las 11:00', async () => {
    await ana();
    const link = await resetLink(ANA);
    t.clock.set('2026-11-11T11:00:00.000Z');
    const expired = await reset(link);
    expect(expired.status).toBe(400);
    expect(expired.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');

    t.clock.set(TEST_NOW);
    const fresh = await resetLink(ANA);
    t.clock.set('2026-11-11T10:59:00.000Z');
    expect((await reset(fresh)).status).toBe(200);
  });

  it('C2-6: usado dos veces, la segunda da 400; un token de verificación aquí, también', async () => {
    await ana();
    const link = await resetLink(ANA);
    expect((await reset(link)).status).toBe(200);
    const again = await reset(link);
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');

    const { link: verifyLink } = await registerBeto(t.app, t.db);
    const wrongPurpose = await reset(verifyLink);
    expect(wrongPurpose.status).toBe(400);
    expect(wrongPurpose.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');
    expect((await userRow(BETO))?.emailVerifiedAt).toBeNull();
  });

  it('C2-7: una contraseña de 9 caracteres → 400 y el enlace sigue valiendo', async () => {
    await ana();
    const link = await resetLink(ANA);
    const response = await reset(link, 'a'.repeat(9));
    expect(response.status).toBe(400);
    expect(response.body.error.fields).toEqual([{ path: 'password', issue: 'too_short' }]);
    expect((await inspect(link)).status).toBe(200);
  });

  it('C2-8: Beto (sin verificar) con 2 sesiones de un ocupante: se cierran, queda verificado y pendiente de revisión', async () => {
    await registerBeto(t.app, t.db);
    const occupant = [await loginToken(t.app, BETO), await loginToken(t.app, BETO)];
    const link = await resetLink(BETO);
    const response = await reset(link);
    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ emailVerified: true, dataReviewRequired: true });
    for (const token of occupant) expect(await sessionStatus(token)).toBe(401);
    const row = await userRow(BETO);
    expect(row?.emailVerifiedAt?.toISOString()).toBe(TEST_NOW);
    expect(row?.dataReviewRequiredAt?.toISOString()).toBe(TEST_NOW);
  });

  it('C2-9: Ana (ya verificada) restablece y data_review_required_at sigue nulo', async () => {
    await ana();
    const link = await resetLink(ANA);
    expect((await reset(link)).status).toBe(200);
    expect((await userRow(ANA))?.dataReviewRequiredAt).toBeNull();
  });

  it('C2-10: un login con la contraseña vieja que espera al restablecimiento en curso → 401, sin sesión vieja', async () => {
    await ana();
    const link = await resetLink(ANA);
    const anaId = (await userRow(ANA))!.id;
    await t.db.execute(sql`delete from sessions`);

    // El restablecimiento se para con la fila de Ana bloqueada (FOR UPDATE), antes de su COMMIT.
    const sessionsService = t.app.get(SessionsService);
    const revokeAll = sessionsService.revokeAllForUser.bind(sessionsService);
    let reached!: () => void;
    const inReset = new Promise<void>((resolve) => (reached = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(sessionsService, 'revokeAllForUser').mockImplementation(async (db, userId) => {
      reached();
      await gate;
      return revokeAll(db, userId);
    });

    const resetting = reset(link).then((response) => response);
    await inReset;
    // El login verifica la contraseña vieja (fuera de la transacción) y espera al bloqueo.
    const loggingIn = login(ANA, TEST_PASSWORD).then((response) => response);
    await waitForLockWait();
    release();

    const [resetResponse, loginResponse] = await Promise.all([resetting, loggingIn]);
    expect(resetResponse.status).toBe(200);
    expect(loginResponse.status).toBe(401);
    expect(loginResponse.body.error.code).toBe('INVALID_CREDENTIALS');
    // Solo queda la sesión que abrió el restablecimiento.
    const remaining = await t.db.execute<{ count: string }>(
      sql`select count(*)::text as count from sessions where user_id = ${anaId}`,
    );
    expect(Number(remaining.rows[0]?.count)).toBe(1);
  });

  it('C2-11: con el SMTP caído de 10:00 a 12:00, el enlace que sale a las 12:00 caduca a las 13:00', async () => {
    await ana();
    inbox(t.app).clear();
    await t.db.delete(emailTokens);
    inbox(t.app).failNext(3, { permanent: false });
    expect((await requestReset(ANA)).status).toBe(202);
    for (const at of ['2026-11-11T10:00:00Z', '2026-11-11T10:00:30Z', '2026-11-11T10:02:30Z']) {
      t.clock.set(at);
      await deliverMail(t.app);
    }
    expect(inbox(t.app).messagesTo(ANA)).toEqual([]);
    t.clock.set('2026-11-11T12:00:00.000Z');
    await deliverMail(t.app);
    const link = linkTo(t.app, ANA, '/reset-password');
    const [token] = await t.db.select().from(emailTokens);
    expect(token?.expiresAt.toISOString()).toBe('2026-11-11T13:00:00.000Z');

    t.clock.set('2026-11-11T12:59:00.000Z');
    expect((await inspect(link)).status).toBe(200);
    t.clock.set('2026-11-11T13:00:00.000Z');
    expect((await inspect(link)).status).toBe(400);
  });

  it('C2-12: la 6.ª solicitud del mismo correo en 24 h → 429, exista o no la cuenta', async () => {
    await ana();
    for (const email of [ANA, NADIE]) {
      for (let i = 1; i <= 5; i += 1) {
        expect((await requestReset(email)).status, `${email} #${i}`).toBe(202);
      }
    }
    const forAna = await requestReset(ANA);
    const forNadie = await requestReset(NADIE);
    expect(forAna.status).toBe(429);
    expect(forNadie.status).toBe(429);
    expect(forNadie.body).toEqual(forAna.body);
    expect(Number(forAna.headers['retry-after'])).toBeGreaterThan(0);
    expect((await requestReset('nadie2@example.com')).status).toBe(202);
  });

  /** Espera a que alguna conexión de esta base esté esperando un bloqueo. */
  async function waitForLockWait(): Promise<void> {
    for (let i = 0; i < 200; i += 1) {
      const result = await t.db.execute<{ count: string }>(
        sql`select count(*)::text as count from pg_stat_activity
            where datname = current_database() and wait_event_type = 'Lock'`,
      );
      if (Number(result.rows[0]?.count) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('Ninguna conexión llegó a esperar el bloqueo');
  }
});
