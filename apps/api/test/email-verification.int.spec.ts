import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { emailOutbox, emailTokens, sessions, users } from '../src/database/schema/index.js';
import { EmailTokensService } from '../src/mail/email-tokens.service.js';
import { PasswordService } from '../src/users/password.service.js';
import { UsersService } from '../src/users/users.service.js';
import {
  ANA,
  BETO,
  CARLA,
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

/** B.3: comprobar, confirmar y reenviar (correo §5.3, §5.4). */
describe('B.3: verificación del correo', () => {
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

  const inspect = (token: string, bearer?: string, purpose = 'verify_email') => {
    const req = api(t.app).post('/auth/email-tokens/inspection');
    if (bearer) req.set('Authorization', `Bearer ${bearer}`);
    return req.send({ token, purpose });
  };
  const confirm = (body: Record<string, unknown>, bearer?: string) => {
    const req = api(t.app).post('/auth/email-verification');
    if (bearer) req.set('Authorization', `Bearer ${bearer}`);
    return req.send(body);
  };
  const betoRow = async () => (await t.db.select().from(users).where(eq(users.email, BETO)))[0];
  const tokensOf = (userId: string) =>
    t.db.select().from(emailTokens).where(eq(emailTokens.userId, userId));
  const ana = () => registerUser(t.app, { email: ANA, password: TEST_PASSWORD });

  it('B3-1: la comprobación da la pista y si la sesión es de esa cuenta, sin consumir el enlace', async () => {
    const { link } = await registerBeto(t.app, t.db);
    const anonymous = await inspect(link);
    expect(anonymous.status).toBe(200);
    expect(anonymous.body).toEqual({ emailHint: 'b•••@example.com', sessionMatches: false });
    expect((await inspect(link)).status).toBe(200);

    const betoSession = await loginToken(t.app, BETO);
    expect((await inspect(link, betoSession)).body.sessionMatches).toBe(true);
    const anaSession = (await ana()).token;
    expect((await inspect(link, anaSession)).body.sessionMatches).toBe(false);
  });

  it('B3-2: token inventado, caducado o de otro propósito → 400 TOKEN_INVALID_OR_EXPIRED', async () => {
    const { userId, link } = await registerBeto(t.app, t.db);
    const invented = await inspect('x'.repeat(43));
    expect(invented.status).toBe(400);
    expect(invented.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');

    const otherPurpose = await inspect(link, undefined, 'reset_password');
    expect(otherPurpose.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');

    // Un enlace de recuperación comprobado como verify_email.
    const resetLink = await t.app
      .get(EmailTokensService)
      .issue(t.db, { userId, purpose: 'reset_password', email: BETO, ttlMs: 60 * 60_000 });
    expect((await inspect(resetLink)).body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');

    t.clock.set('2026-11-12T10:00:00Z');
    const expired = await inspect(link);
    expect(expired.status).toBe(400);
    expect(expired.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');
  });

  it('B3-3: sin sesión y con su contraseña → opened, verificado y el enlace ya no sirve', async () => {
    const { userId, link } = await registerBeto(t.app, t.db);
    const response = await confirm({ token: link, password: TEST_PASSWORD });
    expect(response.status).toBe(200);
    expect(response.body.session).toBe('opened');
    expect(response.body.auth.user).toMatchObject({ email: BETO, emailVerified: true });

    const session = await api(t.app)
      .get('/auth/session')
      .set('Authorization', `Bearer ${response.body.auth.session.token}`);
    expect(session.status).toBe(200);
    expect((await betoRow())?.emailVerifiedAt?.toISOString()).toBe(TEST_NOW);
    expect(await tokensOf(userId)).toEqual([]);

    const again = await confirm({ token: link, password: TEST_PASSWORD });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');
  });

  it('B3-4: sin sesión y sin contraseña → 400 password required, y el enlace sigue valiendo', async () => {
    const { link } = await registerBeto(t.app, t.db);
    const response = await confirm({ token: link });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: [{ path: 'password', issue: 'required' }],
    });
    expect((await inspect(link)).status).toBe(200);
  });

  it('B3-5: 4 contraseñas erróneas → PASSWORD_INCORRECT; la 5.ª anula el enlace', async () => {
    const { userId, link } = await registerBeto(t.app, t.db);
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const wrong = await confirm({ token: link, password: `mala-contraseña-${attempt}` });
      expect(wrong.status).toBe(403);
      expect(wrong.body.error.code).toBe('PASSWORD_INCORRECT');
    }
    expect((await tokensOf(userId))[0]?.failedAttempts).toBe(4);

    const fifth = await confirm({ token: link, password: 'mala-contraseña-5' });
    expect(fifth.status).toBe(403);
    expect(fifth.body.error.code).toBe('TOKEN_ATTEMPTS_EXCEEDED');
    expect(await tokensOf(userId)).toEqual([]);

    const right = await confirm({ token: link, password: TEST_PASSWORD });
    expect(right.status).toBe(400);
    expect(right.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');
    expect((await betoRow())?.emailVerifiedAt).toBeNull();
  });

  it('B3-6: con la sesión de Beto basta el botón → same, sin sesión nueva', async () => {
    const { link } = await registerBeto(t.app, t.db);
    const betoSession = await loginToken(t.app, BETO);
    const before = await countRows(t.db, 'sessions');
    const response = await confirm({ token: link }, betoSession);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ session: 'same' });
    expect(await countRows(t.db, 'sessions')).toBe(before);
    expect((await betoRow())?.emailVerifiedAt).not.toBeNull();
  });

  it('B3-7: con la sesión de Ana se pide la contraseña de Beto → kept-other, sin tocar sesiones', async () => {
    const { link } = await registerBeto(t.app, t.db);
    const anaSession = (await ana()).token;
    const missing = await confirm({ token: link }, anaSession);
    expect(missing.status).toBe(400);
    expect(missing.body.error.fields).toEqual([{ path: 'password', issue: 'required' }]);

    const before = await t.db.select().from(sessions);
    const response = await confirm({ token: link, password: TEST_PASSWORD }, anaSession);
    expect(response.body).toEqual({ session: 'kept-other' });
    expect(await t.db.select().from(sessions)).toEqual(before);
    const stillAna = await api(t.app)
      .get('/auth/session')
      .set('Authorization', `Bearer ${anaSession}`);
    expect(stillAna.status).toBe(200);
    expect(stillAna.body.user.email).toBe(ANA);
  });

  it('B3-8: el enlace vale hasta 24 h después de emitirse', async () => {
    const first = await registerBeto(t.app, t.db);
    t.clock.set('2026-11-12T09:59:00Z');
    expect((await confirm({ token: first.link, password: TEST_PASSWORD })).status).toBe(200);

    await truncateAll(t.db);
    inbox(t.app).clear();
    t.clock.set(TEST_NOW);
    const second = await registerBeto(t.app, t.db);
    t.clock.set('2026-11-12T10:00:00Z');
    const late = await confirm({ token: second.link, password: TEST_PASSWORD });
    expect(late.status).toBe(400);
    expect(late.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');
  });

  it('B3-9: reenviar a Beto manda otro correo y anula el enlace del primero', async () => {
    const { link } = await registerBeto(t.app, t.db);
    const response = await api(t.app)
      .post('/auth/email-verification/request')
      .send({ email: BETO });
    expect(response.status).toBe(202);
    expect(response.text).toBe('');
    await deliverMail(t.app);
    expect(inbox(t.app).messagesTo(BETO)).toHaveLength(2);
    expect((await inspect(link)).body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');
    expect((await inspect(linkTo(t.app, BETO, '/verify-email'))).status).toBe(200);
  });

  it('B3-10: dos reenvíos seguidos sin drain() → una fila y un correo', async () => {
    await registerBeto(t.app, t.db);
    inbox(t.app).clear();
    for (let i = 0; i < 2; i += 1) {
      await api(t.app)
        .post('/auth/email-verification/request')
        .send({ email: ' Beto@Example.com ' });
    }
    expect(await countRows(t.db, 'email_outbox')).toBe(1);
    await deliverMail(t.app);
    expect(inbox(t.app).messagesTo(BETO)).toHaveLength(1);
  });

  it('B3-11: reenvío para Ana, Carla y Nadie → 202 idéntico, sin consultar users, y ningún correo', async () => {
    await ana();
    await seedCarla(t.db);
    inbox(t.app).clear();
    const usersService = t.app.get(UsersService);
    const spies = Object.getOwnPropertyNames(UsersService.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => vi.spyOn(usersService, name as keyof UsersService));

    const responses = [];
    for (const email of [ANA, CARLA, NADIE]) {
      responses.push(await api(t.app).post('/auth/email-verification/request').send({ email }));
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    for (const response of responses) {
      expect(response.status).toBe(202);
      expect(response.text).toBe('');
    }
    vi.restoreAllMocks();
    await deliverMail(t.app);
    expect(inbox(t.app).messages).toEqual([]);
  });

  it('B3-12: login con la contraseña ya verificada y cambiada antes de crear la sesión → 401, sin sesión', async () => {
    const user = await ana();
    const before = await countRows(t.db, 'sessions');
    const passwords = t.app.get(PasswordService);
    const verify = passwords.verify.bind(passwords);
    vi.spyOn(passwords, 'verify').mockImplementation(async (hash, password) => {
      const ok = await verify(hash, password);
      // Otra conexión restablece la contraseña y hace COMMIT entre la verificación y la sesión.
      await t.db
        .update(users)
        .set({ passwordHash: await passwords.hash('otra frase larga distinta') })
        .where(eq(users.id, user.userId));
      return ok;
    });
    const response = await api(t.app)
      .post('/auth/login')
      .send({ email: ANA, password: TEST_PASSWORD });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(await countRows(t.db, 'sessions')).toBe(before);
  });

  it('B3-12: lo mismo al confirmar el correo sin sesión → 403 PASSWORD_INCORRECT y el enlace sigue vivo', async () => {
    const { link } = await registerBeto(t.app, t.db);
    const passwords = t.app.get(PasswordService);
    const verify = passwords.verify.bind(passwords);
    vi.spyOn(passwords, 'verify').mockImplementation(async (hash, password) => {
      const ok = await verify(hash, password);
      await t.db
        .update(users)
        .set({ passwordHash: await passwords.hash('otra frase larga distinta') })
        .where(eq(users.email, BETO));
      return ok;
    });
    const response = await confirm({ token: link, password: TEST_PASSWORD });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('PASSWORD_INCORRECT');
    expect(await countRows(t.db, 'sessions')).toBe(0);
    expect((await betoRow())?.emailVerifiedAt).toBeNull();
    vi.restoreAllMocks();
    expect((await inspect(link)).status).toBe(200);
  });

  it('confirmar borra los correos de verificación pendientes de esa dirección', async () => {
    const { link } = await registerBeto(t.app, t.db);
    await api(t.app).post('/auth/email-verification/request').send({ email: BETO });
    expect(await countRows(t.db, 'email_outbox')).toBe(1);
    // El reenvío aún no ha salido: el enlace del primer correo sigue valiendo.
    expect((await confirm({ token: link, password: TEST_PASSWORD })).status).toBe(200);
    expect(await t.db.select().from(emailOutbox)).toEqual([]);
  });
});
