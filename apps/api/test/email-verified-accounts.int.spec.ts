import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { emailTokens, users } from '../src/database/schema/index.js';
import { ANA, BETO, inbox, loginToken, registerBeto, TEST_PASSWORD } from './helpers/mail.js';
import { runFlow, signupBody } from './helpers/oauth.js';
import {
  api,
  createTestApp,
  registerUser,
  resetRateLimits,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

/** B.4: `emailVerified`, proveedores y `@RequiresVerifiedEmail()` (correo §5.8 a §5.10). */
describe('B.4: correo verificado en la sesión, la cuenta y los proveedores', () => {
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
  });

  const me = (token: string) => api(t.app).get('/users/me').set('Authorization', `Bearer ${token}`);
  const verifiedAt = async (email: string) =>
    (await t.db.select().from(users).where(eq(users.email, email)))[0]?.emailVerifiedAt;

  it('B4-1: sin verificar, emailVerified falso y fecha de borrado; tras confirmar, verificado y sin fecha', async () => {
    const { link } = await registerBeto(t.app, t.db);
    const login = await api(t.app)
      .post('/auth/login')
      .send({ email: BETO, password: TEST_PASSWORD });
    expect(login.body.user.emailVerified).toBe(false);
    const before = await me(login.body.session.token as string);
    expect(before.body.user).toMatchObject({
      emailVerified: false,
      emailVerifiedAt: null,
      unverifiedDeletionAt: '2026-11-18T10:00:00.000Z',
    });

    t.clock.set('2026-11-11T12:00:00Z');
    const confirmed = await api(t.app)
      .post('/auth/email-verification')
      .set('Authorization', `Bearer ${login.body.session.token}`)
      .send({ token: link });
    expect(confirmed.body).toEqual({ session: 'same' });
    const session = await api(t.app)
      .get('/auth/session')
      .set('Authorization', `Bearer ${login.body.session.token}`);
    expect(session.body.user.emailVerified).toBe(true);
    const after = await me(login.body.session.token as string);
    expect(after.body.user).toMatchObject({
      emailVerified: true,
      emailVerifiedAt: '2026-11-11T12:00:00.000Z',
      unverifiedDeletionAt: null,
    });
  });

  it.each(['google', 'facebook'] as const)(
    'B4-2: un alta con %s nace con email_verified_at = reloj',
    async (provider) => {
      const flow = await runFlow(t.app, {
        provider,
        entryPoint: 'register',
        identity: { email: 'dani@gmail.com' },
      });
      expect(flow.response.body.result).toBe('signup_required');
      const created = await api(t.app)
        .post('/auth/oauth/signup')
        .send(signupBody(flow.response.body.pending.token as string));
      expect(created.status).toBe(201);
      expect(created.body.user.emailVerified).toBe(true);
      expect((await verifiedAt('dani@gmail.com'))?.toISOString()).toBe(TEST_NOW);
    },
  );

  it('B4-3: Google de Beto sin verificar → link_required con accountEmailVerified falso; unir verifica', async () => {
    const { userId } = await registerBeto(t.app, t.db);
    const flow = await runFlow(t.app, { identity: { email: BETO } });
    expect(flow.response.body.result).toBe('link_required');
    const pendingToken = flow.response.body.pending.token as string;
    const pending = await api(t.app)
      .get('/auth/oauth/pending')
      .set('X-Oauth-Pending-Token', pendingToken);
    expect(pending.body).toMatchObject({ kind: 'link', accountEmailVerified: false });

    const linked = await api(t.app)
      .post('/auth/oauth/link')
      .send({ pendingToken, email: BETO, password: TEST_PASSWORD });
    expect(linked.status).toBe(200);
    expect(linked.body.user.emailVerified).toBe(true);
    expect(await verifiedAt(BETO)).not.toBeNull();
    expect(await t.db.select().from(emailTokens).where(eq(emailTokens.userId, userId))).toEqual([]);
  });

  it('B4-3: con la cuenta verificada, accountEmailVerified es verdadero', async () => {
    await registerUser(t.app, { email: ANA, password: TEST_PASSWORD });
    const flow = await runFlow(t.app, { identity: { email: ANA } });
    const pending = await api(t.app)
      .get('/auth/oauth/pending')
      .set('X-Oauth-Pending-Token', flow.response.body.pending.token as string);
    expect(pending.body.accountEmailVerified).toBe(true);
  });

  it('B4-4: añadir Google sin verificar → 403 EMAIL_NOT_VERIFIED; Ana, verificada, recibe 201', async () => {
    await registerBeto(t.app, t.db);
    const beto = await loginToken(t.app, BETO);
    const refused = await api(t.app)
      .post('/users/me/oauth/google/authorization')
      .set('Authorization', `Bearer ${beto}`)
      .send({ purpose: 'connect', password: TEST_PASSWORD });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    const ana = await registerUser(t.app, { email: ANA, password: TEST_PASSWORD });
    const accepted = await api(t.app)
      .post('/users/me/oauth/google/authorization')
      .set('Authorization', `Bearer ${ana.token}`)
      .send({ purpose: 'connect', password: TEST_PASSWORD });
    expect(accepted.status).toBe(201);
  });
});
