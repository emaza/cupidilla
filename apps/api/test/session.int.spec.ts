import { SERVICE_TERMS_VERSION } from '@cupidilla/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateOpaqueToken, hashOpaqueToken } from '../src/common/crypto/opaque-token.js';
import { sessions } from '../src/database/schema/index.js';
import {
  api,
  createTestApp,
  registerUser,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Sesión', () => {
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

  const getSession = (token: string) =>
    api(t.app).get('/auth/session').set('Authorization', `Bearer ${token}`);

  const sessionRow = async (token: string) =>
    (
      await t.db
        .select()
        .from(sessions)
        .where(eq(sessions.tokenHash, hashOpaqueToken(token)))
    )[0];

  describe('GET /auth/session (I-12)', () => {
    it('con un token válido responde 200 sin renovar', async () => {
      const user = await registerUser(t.app);
      const response = await getSession(user.token);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        user: { id: user.userId, email: user.email, createdAt: TEST_NOW, emailVerified: true },
        session: {
          expiresAt: new Date(new Date(TEST_NOW).getTime() + 30 * DAY_MS).toISOString(),
          renewed: false,
        },
      });
    });

    it('con un token inventado o mal formado responde 401', async () => {
      expect((await getSession(generateOpaqueToken())).status).toBe(401);
      const malformed = await api(t.app).get('/auth/session').set('Authorization', 'Bearer corto');
      expect(malformed.status).toBe(401);
      expect(malformed.body.error.code).toBe('UNAUTHENTICATED');
      expect((await api(t.app).get('/auth/session')).status).toBe(401);
    });

    it('31 días después responde 401 y borra la fila', async () => {
      const user = await registerUser(t.app);
      t.clock.advanceDays(31);
      expect((await getSession(user.token)).status).toBe(401);
      expect(await sessionRow(user.token)).toBeUndefined();
    });

    it('14 días después todavía no la renueva', async () => {
      const user = await registerUser(t.app);
      const before = (await sessionRow(user.token))?.expiresAt.getTime();
      t.clock.advanceDays(14);
      const response = await getSession(user.token);
      expect(response.status).toBe(200);
      expect(response.body.session.renewed).toBe(false);
      expect((await sessionRow(user.token))?.expiresAt.getTime()).toBe(before);
    });

    it('16 días después renueva la sesión', async () => {
      const user = await registerUser(t.app);
      t.clock.advanceDays(16);
      const response = await getSession(user.token);
      expect(response.status).toBe(200);
      expect(response.body.session.renewed).toBe(true);
      const expected = t.clock.now().getTime() + 30 * DAY_MS;
      expect(new Date(response.body.session.expiresAt).getTime()).toBe(expected);
      expect((await sessionRow(user.token))?.expiresAt.getTime()).toBe(expected);
    });
  });

  it('I-14: salir revoca el token al instante', async () => {
    const user = await registerUser(t.app);
    const logout = await api(t.app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${user.token}`);
    expect(logout.status).toBe(204);
    expect((await getSession(user.token)).status).toBe(401);
    expect(await sessionRow(user.token)).toBeUndefined();
    const again = await api(t.app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${user.token}`);
    expect(again.status).toBe(401);
  });

  it('GET /users/me devuelve la cuenta con su consentimiento', async () => {
    const user = await registerUser(t.app, { birthDate: '1990-05-05' });
    const response = await api(t.app).get('/users/me').set('Authorization', `Bearer ${user.token}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user: {
        id: user.userId,
        email: user.email,
        createdAt: TEST_NOW,
        emailVerified: true,
        birthDate: '1990-05-05',
        emailVerifiedAt: TEST_NOW,
        unverifiedDeletionAt: null,
      },
      consents: [
        {
          purpose: 'service_use',
          policyVersion: SERVICE_TERMS_VERSION,
          grantedAt: TEST_NOW,
          revokedAt: null,
        },
      ],
      signInMethods: { password: true, identities: [] },
      session: { authenticatedAt: TEST_NOW },
      sessions: [
        {
          createdAt: TEST_NOW,
          authenticatedAt: TEST_NOW,
          expiresAt: new Date(new Date(TEST_NOW).getTime() + 30 * DAY_MS).toISOString(),
          current: true,
        },
      ],
    });
    expect((await api(t.app).get('/users/me')).status).toBe(401);
  });
});
