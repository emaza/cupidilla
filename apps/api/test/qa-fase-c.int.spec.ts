import { SERVICE_TERMS_VERSION } from '@cupidilla/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { consents, users } from '../src/database/schema/index.js';
import { NEW_PASSWORD, pendingBeto } from './helpers/data-review.js';
import {
  ANA,
  BETO,
  deliverMail,
  inbox,
  linkTo,
  registerBeto,
  TEST_PASSWORD,
} from './helpers/mail.js';
import {
  api,
  createTestApp,
  registerUser,
  resetRateLimits,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

/** QA de la fase C: carreras del restablecimiento y consentimiento en la revisión de datos. */
describe('QA fase C', () => {
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

  const review = (token: string, body: Record<string, unknown> = {}) =>
    api(t.app)
      .post('/users/me/data-review')
      .set('Authorization', `Bearer ${token}`)
      .send({
        birthDate: '1990-05-05',
        acceptTerms: true,
        termsVersion: SERVICE_TERMS_VERSION,
        ...body,
      });
  const consentsOf = (userId: string) =>
    t.db.select().from(consents).where(eq(consents.userId, userId)).orderBy(consents.grantedAt);

  async function resetLink(email: string): Promise<string> {
    await api(t.app).post('/auth/password-reset/request').send({ email });
    await deliverMail(t.app);
    return linkTo(t.app, email, '/reset-password');
  }

  it('el mismo enlace usado a la vez desde 5 peticiones da exactamente un 200 y una sola sesión nueva', async () => {
    await registerUser(t.app, { email: ANA, password: TEST_PASSWORD });
    const link = await resetLink(ANA);
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        api(t.app)
          .post('/auth/password-reset')
          .send({ token: link, password: `${NEW_PASSWORD} ${i}` }),
      ),
    );
    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 400)).toHaveLength(4);
    // La contraseña que quedó es la de la petición que ganó.
    const winner = responses.findIndex((r) => r.status === 200);
    const ok = await api(t.app)
      .post('/auth/login')
      .send({ email: ANA, password: `${NEW_PASSWORD} ${winner}` });
    expect(ok.status).toBe(200);
  });

  it('la revisión con adulto no registra consentimiento si acceptTerms no es true (falso, ausente, "true")', async () => {
    const { userId, token } = await pendingBeto(t);
    const before = await consentsOf(userId);
    for (const acceptTerms of [false, undefined, 'true', 'on', 1, null]) {
      const response = await review(token, { acceptTerms });
      expect(response.status, String(acceptTerms)).toBe(400);
    }
    expect(await consentsOf(userId)).toEqual(before);
    const [row] = await t.db.select().from(users).where(eq(users.id, userId));
    expect(row?.dataReviewRequiredAt).not.toBeNull();
  });

  it('la fecha de un menor no se guarda ni sale en logs, y el log sí captura el evento (no vacío)', async () => {
    const { token } = await pendingBeto(t);
    const output: string[] = [];
    const capture = (chunk: unknown): boolean => {
      output.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(capture);
    vi.spyOn(process.stderr, 'write').mockImplementation(capture);
    const response = await review(token, { birthDate: '2015-03-04' });
    // Un 422 con la cuenta ya borrada: la segunda petición con la misma sesión da 401.
    const second = await review(token, { birthDate: '2015-03-04' });
    vi.restoreAllMocks();
    expect(response.status).toBe(422);
    expect(second.status).toBe(401);
    const logs = output.join('');
    expect(logs).toContain('underage_review');
    expect(logs).not.toContain('2015');
    expect(logs).not.toContain('03-04');
  });

  it('dos revisiones simultáneas válidas: un solo consentimiento vigente', async () => {
    const { userId, token } = await pendingBeto(t);
    const responses = await Promise.all([review(token), review(token), review(token)]);
    expect(responses.filter((r) => r.status === 204)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 404)).toHaveLength(2);
    const active = (await consentsOf(userId)).filter((c) => c.revokedAt === null);
    expect(active).toHaveLength(1);
  });

  it('el borrado de cuenta pendiente de revisión no deja el correo en la bandeja de salida', async () => {
    const { token } = await pendingBeto(t);
    inbox(t.app).clear();
    const response = await review(token, { birthDate: '2015-03-04' });
    expect(response.status).toBe(422);
    await deliverMail(t.app);
    expect(inbox(t.app).messagesTo(BETO)).toEqual([]);
  });

  it('registrar de nuevo a Beto tras el borrado por menor no hereda revisión pendiente', async () => {
    const { token } = await pendingBeto(t);
    expect((await review(token, { birthDate: '2015-03-04' })).status).toBe(422);
    const { userId } = await registerBeto(t.app, t.db);
    const [row] = await t.db.select().from(users).where(eq(users.id, userId));
    expect(row?.dataReviewRequiredAt).toBeNull();
  });
});
