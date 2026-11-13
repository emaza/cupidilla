import { SERVICE_TERMS_VERSION } from '@cupidilla/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { consents } from '../src/database/schema/index.js';
import { runFlow, signupBody } from './helpers/oauth.js';
import {
  api,
  createTestApp,
  registerBody,
  registerUser,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

const PREVIOUS_VERSION = '2026-11-borrador';

describe('O-25: versión nueva de las condiciones sin re-consentimiento (§13)', () => {
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

  it('la versión vigente es la nueva', () => {
    expect(SERVICE_TERMS_VERSION).toBe('2026-11-borrador-2');
  });

  it('una cuenta que aceptó la versión anterior entra, la ve en /users/me y no se le pide nada', async () => {
    const user = await registerUser(t.app);
    await t.db
      .update(consents)
      .set({ policyVersion: PREVIOUS_VERSION })
      .where(eq(consents.userId, user.userId));

    const login = await api(t.app)
      .post('/auth/login')
      .send({ email: user.email, password: user.password });
    expect(login.status).toBe(200);
    const account = await api(t.app)
      .get('/users/me')
      .set('Authorization', `Bearer ${login.body.session.token as string}`);
    expect(account.status).toBe(200);
    expect(account.body.consents).toMatchObject([
      { purpose: 'service_use', policyVersion: PREVIOUS_VERSION, revokedAt: null },
    ]);
  });

  it('el alta con correo o con proveedor y la versión anterior → 409 TERMS_VERSION_OUTDATED', async () => {
    const register = await api(t.app)
      .post('/auth/register')
      .send(registerBody({ termsVersion: PREVIOUS_VERSION }));
    expect(register.status).toBe(409);
    expect(register.body.error.code).toBe('TERMS_VERSION_OUTDATED');

    const flow = await runFlow(t.app);
    const signup = await api(t.app)
      .post('/auth/oauth/signup')
      .send(
        signupBody(flow.response.body.pending.token as string, { termsVersion: PREVIOUS_VERSION }),
      );
    expect(signup.status).toBe(409);
    expect(signup.body.error.code).toBe('TERMS_VERSION_OUTDATED');
  });

  it('las altas nuevas guardan la versión nueva', async () => {
    const user = await registerUser(t.app);
    const [row] = await t.db.select().from(consents).where(eq(consents.userId, user.userId));
    expect(row?.policyVersion).toBe('2026-11-borrador-2');
  });
});
