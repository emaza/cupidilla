import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SessionsService } from '../src/auth/sessions.service.js';
import { hashOpaqueToken } from '../src/common/crypto/opaque-token.js';
import { oauthStates } from '../src/database/schema/index.js';
import {
  api,
  countRows,
  createTestApp,
  registerUser,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

describe('A5-1: revokeAllForUser (correo §4.1)', () => {
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

  const sessionStatus = async (token: string) =>
    (await api(t.app).get('/auth/session').set('Authorization', `Bearer ${token}`)).status;

  it('cierra las 3 sesiones de Ana y su reautenticación a medias; la de Beto sigue', async () => {
    const ana = await registerUser(t.app, { email: 'ana@example.com' });
    const anaTokens = [ana.token];
    for (let i = 0; i < 2; i += 1) {
      const login = await api(t.app)
        .post('/auth/login')
        .send({ email: ana.email, password: ana.password });
      expect(login.status).toBe(200);
      anaTokens.push(login.body.session.token as string);
    }
    const beto = await registerUser(t.app, { email: 'beto@example.com' });
    // Una reautenticación a medias que cuelga de una de las sesiones de Ana.
    await t.db.insert(oauthStates).values({
      tokenHash: 'd'.repeat(64),
      provider: 'google',
      purpose: 'reauthenticate',
      sessionTokenHash: hashOpaqueToken(anaTokens[1]!),
      state: 's',
      codeVerifier: 'v',
      nonce: 'n',
      createdAt: t.clock.now(),
      expiresAt: new Date(t.clock.now().getTime() + 10 * 60_000),
    });

    const revoked = await t.app.get(SessionsService).revokeAllForUser(t.db, ana.userId);

    expect(revoked).toBe(3);
    for (const token of anaTokens) expect(await sessionStatus(token)).toBe(401);
    expect(await countRows(t.db, 'oauth_states')).toBe(0);
    expect(await sessionStatus(beto.token)).toBe(200);
  });
});
