import { accountResponseSchema } from '@cupidilla/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessions, users } from '../src/database/schema/index.js';
import { PasswordService } from '../src/users/password.service.js';
import {
  api,
  countRows,
  createTestApp,
  registerUser,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Cuentas sin contraseña y sesión autenticada (fase 1)', () => {
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const getAccount = (token: string) =>
    api(t.app).get('/users/me').set('Authorization', `Bearer ${token}`);
  const login = (email: string, password: string) =>
    api(t.app).post('/auth/login').send({ email, password });

  /** Simula una cuenta creada con un proveedor: sin contraseña. */
  async function withoutPassword(userId: string): Promise<void> {
    await t.db.update(users).set({ passwordHash: null }).where(eq(users.id, userId));
  }

  it('las sesiones nuevas nacen con authenticated_at = created_at (registro y login)', async () => {
    const user = await registerUser(t.app);
    t.clock.set('2026-11-11T12:00:00.000Z');
    expect((await login(user.email, user.password)).status).toBe(200);

    const rows = await t.db.select().from(sessions).where(eq(sessions.userId, user.userId));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.authenticatedAt.toISOString()).toBe(row.createdAt.toISOString());
    }
    expect(rows.map((row) => row.authenticatedAt.toISOString()).sort()).toEqual([
      TEST_NOW,
      '2026-11-11T12:00:00.000Z',
    ]);
  });

  it('GET /users/me devuelve las formas de entrar y la fecha de autenticación de la sesión', async () => {
    const user = await registerUser(t.app);
    const response = await getAccount(user.token);
    expect(response.status).toBe(200);
    expect(accountResponseSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.signInMethods).toEqual({ password: true, identities: [] });
    expect(response.body.session).toEqual({ authenticatedAt: TEST_NOW });
  });

  it('renovar la sesión no cambia authenticated_at: no es una nueva autenticación', async () => {
    const user = await registerUser(t.app);
    t.clock.advanceDays(16);
    const session = await api(t.app)
      .get('/auth/session')
      .set('Authorization', `Bearer ${user.token}`);
    expect(session.body.session.renewed).toBe(true);
    expect(
      new Date(session.body.session.expiresAt as string).getTime() - new Date(TEST_NOW).getTime(),
    ).toBe(46 * DAY_MS);

    const account = await getAccount(user.token);
    expect(account.body.session).toEqual({ authenticatedAt: TEST_NOW });
  });

  it('GET /users/me de una cuenta sin contraseña: password false', async () => {
    const user = await registerUser(t.app);
    await withoutPassword(user.userId);
    const response = await getAccount(user.token);
    expect(response.status).toBe(200);
    expect(response.body.signInMethods).toEqual({ password: false, identities: [] });
  });

  it('O-16: login con el correo de una cuenta sin contraseña → 401 idéntico al de una contraseña errónea', async () => {
    const passwords = t.app.get(PasswordService);
    const withHash = await registerUser(t.app);
    const noHash = await registerUser(t.app);
    await withoutPassword(noHash.userId);

    const wrongPassword = await login(withHash.email, 'otra-contraseña');
    const verifyDummy = vi.spyOn(passwords, 'verifyDummy');
    const passwordless = await login(noHash.email, noHash.password);

    expect(passwordless.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(passwordless.body).toEqual(wrongPassword.body);
    expect(passwordless.body).toEqual({
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' },
    });
    // Se calcula argon2 igual que con un correo inexistente: el tiempo no lo delata.
    expect(verifyDummy).toHaveBeenCalledTimes(1);
    expect(await countRows(t.db, 'sessions')).toBe(2); // solo las del registro
  });

  it('borrado: con contraseña en la cuenta, el campo sigue siendo obligatorio (H0)', async () => {
    const user = await registerUser(t.app);
    const response = await api(t.app)
      .post('/users/me/deletion')
      .set('Authorization', `Bearer ${user.token}`)
      .send({});
    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: [{ path: 'password', issue: 'required' }],
    });
    expect(await countRows(t.db, 'users')).toBe(1);
  });

  it('borrado de una cuenta sin contraseña: rechazado sin borrar nada hasta la fase 5', async () => {
    const user = await registerUser(t.app);
    await withoutPassword(user.userId);
    const response = await api(t.app)
      .post('/users/me/deletion')
      .set('Authorization', `Bearer ${user.token}`)
      .send({});
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('REAUTHENTICATION_REQUIRED');
    expect(await countRows(t.db, 'users')).toBe(1);
  });
});
