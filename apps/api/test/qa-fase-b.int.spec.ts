import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { emailTokens, identities, sessions, users } from '../src/database/schema/index.js';
import { PasswordService } from '../src/users/password.service.js';
import { UnverifiedAccountsSweeper } from '../src/users/unverified-accounts.sweeper.js';
import { BETO, inbox, registerBeto, TEST_PASSWORD } from './helpers/mail.js';
import { runFlow } from './helpers/oauth.js';
import {
  api,
  countRows,
  createTestApp,
  resetRateLimits,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

/** QA de la fase B: huecos que no cubrían los tests del programador. */
describe('QA fase B', () => {
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

  const startLink = async () => {
    const { userId } = await registerBeto(t.app, t.db);
    const flow = await runFlow(t.app, { identity: { email: BETO } });
    expect(flow.response.body.result).toBe('link_required');
    return { userId, pendingToken: flow.response.body.pending.token as string };
  };

  it('B3-12 (unión): contraseña cambiada entre la verificación y la unión → 403 PASSWORD_INCORRECT, sin sesión ni identidad ni verificar', async () => {
    const { pendingToken } = await startLink();
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
    const linked = await api(t.app)
      .post('/auth/oauth/link')
      .send({ pendingToken, email: BETO, password: TEST_PASSWORD });
    expect(linked.status).toBe(403);
    expect(linked.body.error.code).toBe('PASSWORD_INCORRECT');
    expect(await countRows(t.db, 'sessions')).toBe(0);
    expect(await t.db.select().from(identities)).toEqual([]);
    expect((await t.db.select().from(users))[0]?.emailVerifiedAt).toBeNull();
  });

  it('unión a la vez que el barrido del día 7: ningún 500 (interbloqueo) y resultado coherente', async () => {
    const sweeper = t.app.get(UnverifiedAccountsSweeper);
    const seen = new Set<string>();
    for (let round = 0; round < 8; round += 1) {
      await truncateAll(t.db);
      resetRateLimits(t.app);
      inbox(t.app).clear();
      t.clock.set(TEST_NOW);
      const { pendingToken } = await startLink();
      t.clock.set('2026-11-18T10:00:00Z');
      const link = () =>
        api(t.app)
          .post('/auth/oauth/link')
          .send({ pendingToken, email: BETO, password: TEST_PASSWORD });
      const [response] =
        round % 2 === 0
          ? await Promise.all([link(), sweeper.sweep()])
          : await Promise.all([sweeper.sweep().then(() => undefined), link()]).then(([, r]) => [r]);
      seen.add(String(response?.status));
      const [row] = await t.db.select().from(users);
      if (row) {
        expect(response?.status, `ronda ${round}`).toBe(200);
        expect(row.emailVerifiedAt).not.toBeNull();
      } else {
        expect([400, 403, 404, 409], `ronda ${round} (${response?.status})`).toContain(
          response?.status,
        );
      }
      expect(response?.status, `ronda ${round}`).toBeLessThan(500);
    }
  });

  it('8 contraseñas erróneas simultáneas: el enlace acaba anulado, nadie abre sesión y la correcta después da 400', async () => {
    const { link } = await registerBeto(t.app, t.db);
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        api(t.app)
          .post('/auth/email-verification')
          .send({ token: link, password: 'incorrecta incorrecta' }),
      ),
    );
    expect(responses.every((r) => [403, 400].includes(r.status))).toBe(true);
    expect(await t.db.select().from(emailTokens)).toEqual([]);
    const ok = await api(t.app)
      .post('/auth/email-verification')
      .send({ token: link, password: TEST_PASSWORD });
    expect(ok.status).toBe(400);
    expect(await t.db.select().from(sessions)).toEqual([]);
  });
});
