import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashOpaqueToken } from '../src/common/crypto/opaque-token.js';
import { consents, sessions, users } from '../src/database/schema/index.js';
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

const DAY_MS = 24 * 60 * 60 * 1000;

describe('POST /auth/register y /auth/login', () => {
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

  async function expectEmptyTables(): Promise<void> {
    expect(await countRows(t.db, 'users')).toBe(0);
    expect(await countRows(t.db, 'sessions')).toBe(0);
    expect(await countRows(t.db, 'consents')).toBe(0);
  }

  it('I-1: registra a una persona adulta con consentimiento y sesión', async () => {
    const body = registerBody({ email: '  Ana.Lopez@Example.COM ', birthDate: '1990-05-05' });
    const response = await api(t.app).post('/auth/register').send(body);

    expect(response.status).toBe(201);
    const { user, session } = response.body as {
      user: { id: string; email: string };
      session: { token: string; expiresAt: string };
    };
    expect(user.email).toBe('ana.lopez@example.com');
    expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const [row] = await t.db.select().from(users);
    expect(row?.email).toBe('ana.lopez@example.com');
    expect(row?.passwordHash?.startsWith('$argon2id$')).toBe(true);
    expect(row?.birthDate).toBe('1990-05-05');

    const consentRows = await t.db.select().from(consents);
    expect(consentRows).toHaveLength(1);
    expect(consentRows[0]).toMatchObject({
      userId: user.id,
      purpose: 'service_use',
      policyVersion: '2026-11-borrador',
      revokedAt: null,
    });
    expect(consentRows[0]?.grantedAt.toISOString()).toBe(TEST_NOW);

    const sessionRows = await t.db.select().from(sessions);
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0]?.tokenHash).toBe(hashOpaqueToken(session.token));
    expect(sessionRows[0]?.expiresAt.getTime()).toBe(new Date(TEST_NOW).getTime() + 30 * DAY_MS);
    expect(session.expiresAt).toBe(sessionRows[0]?.expiresAt.toISOString());
  });

  it('I-2: quien cumple 18 hoy en Madrid (23:30 UTC del día anterior) puede registrarse', async () => {
    t.clock.set('2026-11-10T23:30:00Z');
    const response = await api(t.app)
      .post('/auth/register')
      .send(registerBody({ birthDate: '2008-11-11' }));
    expect(response.status).toBe(201);
  });

  it('I-3: un menor (cumple 18 mañana) recibe 422 UNDERAGE y no se escribe nada', async () => {
    const response = await api(t.app)
      .post('/auth/register')
      .send(registerBody({ birthDate: '2008-11-12' }));
    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      error: { code: 'UNDERAGE', message: 'Minimum age not reached' },
    });
    await expectEmptyTables();
  });

  it('I-4: nacimiento el 29 de febrero, a los dos lados del límite', async () => {
    t.clock.set('2026-02-28T12:00:00Z');
    const adult = await api(t.app)
      .post('/auth/register')
      .send(registerBody({ birthDate: '2008-02-29' }));
    expect(adult.status).toBe(201);

    t.clock.set('2026-02-27T12:00:00Z');
    const minor = await api(t.app)
      .post('/auth/register')
      .send(registerBody({ birthDate: '2008-02-29' }));
    expect(minor.status).toBe(422);
    expect(minor.body.error.code).toBe('UNDERAGE');
  });

  it('I-5: fecha futura → in_future; fecha imposible → invalid_format; sin filas', async () => {
    const future = await api(t.app)
      .post('/auth/register')
      .send(registerBody({ birthDate: '2026-11-12' }));
    expect(future.status).toBe(400);
    expect(future.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: [{ path: 'birthDate', issue: 'in_future' }],
    });

    const impossible = await api(t.app)
      .post('/auth/register')
      .send(registerBody({ birthDate: '2007-02-29' }));
    expect(impossible.status).toBe(400);
    expect(impossible.body.error.fields).toEqual([{ path: 'birthDate', issue: 'invalid_format' }]);
    await expectEmptyTables();
  });

  it('I-6: correo repetido con otras mayúsculas y espacios → 409 EMAIL_TAKEN', async () => {
    await registerUser(t.app, { email: 'ana@example.com' });
    const response = await api(t.app)
      .post('/auth/register')
      .send(registerBody({ email: '  ANA@Example.com ' }));
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('EMAIL_TAKEN');
    expect(await countRows(t.db, 'users')).toBe(1);
  });

  it('I-7: sin aceptar las condiciones o con una versión antigua no se registra', async () => {
    const withoutTerms: Record<string, unknown> = registerBody();
    delete withoutTerms.acceptTerms;
    const missing = await api(t.app).post('/auth/register').send(withoutTerms);
    expect(missing.status).toBe(400);
    expect(missing.body.error.fields).toEqual([{ path: 'acceptTerms', issue: 'required' }]);

    const declined = await api(t.app)
      .post('/auth/register')
      .send(registerBody({ acceptTerms: false }));
    expect(declined.status).toBe(400);

    const outdated = await api(t.app)
      .post('/auth/register')
      .send(registerBody({ termsVersion: '2026-10-antigua' }));
    expect(outdated.status).toBe(409);
    expect(outdated.body.error.code).toBe('TERMS_VERSION_OUTDATED');
    await expectEmptyTables();
  });

  it('I-8: longitud de la contraseña y campos desconocidos', async () => {
    const short = await api(t.app)
      .post('/auth/register')
      .send(registerBody({ password: 'a'.repeat(9) }));
    expect(short.status).toBe(400);
    expect(short.body.error.fields).toEqual([{ path: 'password', issue: 'too_short' }]);

    for (const length of [10, 128]) {
      const ok = await api(t.app)
        .post('/auth/register')
        .send(registerBody({ password: 'a'.repeat(length) }));
      expect(ok.status).toBe(201);
    }

    const long = await api(t.app)
      .post('/auth/register')
      .send(registerBody({ password: 'a'.repeat(129) }));
    expect(long.status).toBe(400);
    expect(long.body.error.fields).toEqual([{ path: 'password', issue: 'too_long' }]);

    const unknown = await api(t.app)
      .post('/auth/register')
      .send({ ...registerBody(), nombre: 'Ana' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.fields).toEqual([{ path: '', issue: 'unrecognized' }]);
  });

  it('I-9: login correcto → 200 con un token nuevo (dos sesiones)', async () => {
    const user = await registerUser(t.app);
    const response = await api(t.app)
      .post('/auth/login')
      .send({ email: user.email.toUpperCase(), password: user.password });
    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ id: user.userId, email: user.email });
    expect(response.body.session.token).not.toBe(user.token);
    expect(await countRows(t.db, 'sessions')).toBe(2);
  });

  it('I-10: contraseña errónea y correo inexistente dan cuerpos idénticos', async () => {
    const user = await registerUser(t.app);
    const wrongPassword = await api(t.app)
      .post('/auth/login')
      .send({ email: user.email, password: 'otra-contraseña' });
    const unknownEmail = await api(t.app)
      .post('/auth/login')
      .send({ email: 'nadie@example.com', password: 'otra-contraseña' });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('el login borra las sesiones caducadas del usuario', async () => {
    const user = await registerUser(t.app);
    t.clock.advanceDays(31);
    const response = await api(t.app)
      .post('/auth/login')
      .send({ email: user.email, password: user.password });
    expect(response.status).toBe(200);
    const rows = await t.db.select().from(sessions).where(eq(sessions.userId, user.userId));
    expect(rows.map((row) => row.tokenHash)).toEqual([
      hashOpaqueToken(response.body.session.token),
    ]);
  });
});
