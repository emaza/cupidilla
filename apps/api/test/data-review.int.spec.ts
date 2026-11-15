import { SERVICE_TERMS_VERSION } from '@cupidilla/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { consents, users } from '../src/database/schema/index.js';
import { NEW_PASSWORD, pendingBeto, rowsReferencingUser } from './helpers/data-review.js';
import { ANA, BETO, inbox, loginToken, registerBeto, TEST_PASSWORD } from './helpers/mail.js';
import {
  api,
  createTestApp,
  registerUser,
  resetRateLimits,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

/** C.3: revisión de datos (correo §5.11). */
describe('C.3: revisión de datos', () => {
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
  const connectGoogle = (token: string, password = NEW_PASSWORD) =>
    api(t.app)
      .post('/users/me/oauth/google/authorization')
      .set('Authorization', `Bearer ${token}`)
      .send({ purpose: 'connect', password });
  const userRow = async (userId: string) =>
    (await t.db.select().from(users).where(eq(users.id, userId)))[0];
  const consentsOf = (userId: string) =>
    t.db.select().from(consents).where(eq(consents.userId, userId)).orderBy(consents.grantedAt);

  it('C3-1: pendiente, la sesión, /users/me y el cierre funcionan; el resto da 403 DATA_REVIEW_REQUIRED', async () => {
    const { token } = await pendingBeto(t);
    const bearer = `Bearer ${token}`;
    const me = await api(t.app).get('/users/me').set('Authorization', bearer);
    expect(me.status).toBe(200);
    expect(me.body.user.dataReviewRequired).toBe(true);
    const session = await api(t.app).get('/auth/session').set('Authorization', bearer);
    expect(session.status).toBe(200);
    expect(session.body.user.dataReviewRequired).toBe(true);

    const oauth = await connectGoogle(token);
    expect(oauth.status).toBe(403);
    expect(oauth.body.error.code).toBe('DATA_REVIEW_REQUIRED');
    const reauth = await api(t.app)
      .post('/users/me/reauthentication')
      .set('Authorization', bearer)
      .send({ password: NEW_PASSWORD });
    expect(reauth.status).toBe(403);
    expect(reauth.body.error.code).toBe('DATA_REVIEW_REQUIRED');

    expect((await api(t.app).post('/auth/logout').set('Authorization', bearer)).status).toBe(204);
  });

  it('C3-2: la revisión correcta quita la marca, revoca la aceptación anterior y registra una nueva', async () => {
    const { userId, token } = await pendingBeto(t);
    t.clock.set('2026-11-11T10:05:00.000Z');
    const response = await review(token);
    expect(response.status).toBe(204);
    expect((await userRow(userId))?.dataReviewRequiredAt).toBeNull();

    const rows = await consentsOf(userId);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.grantedAt.toISOString()).toBe(TEST_NOW);
    expect(rows[0]?.revokedAt?.toISOString()).toBe('2026-11-11T10:05:00.000Z');
    expect(rows[1]).toMatchObject({ policyVersion: SERVICE_TERMS_VERSION, revokedAt: null });
    expect(rows[1]?.grantedAt.toISOString()).toBe('2026-11-11T10:05:00.000Z');

    const oauth = await connectGoogle(token);
    expect(oauth.body.error?.code).not.toBe('DATA_REVIEW_REQUIRED');
    expect(oauth.status).toBe(201);
  });

  it('C3-3: con otra fecha, birth_date pasa a la nueva', async () => {
    const { userId, token } = await pendingBeto(t);
    expect((await userRow(userId))?.birthDate).toBe('1990-05-05');
    expect((await review(token, { birthDate: '1985-01-20' })).status).toBe(204);
    expect((await userRow(userId))?.birthDate).toBe('1985-01-20');
  });

  it('C3-4: MIN_AGE 18 y el 12 de noviembre en Madrid: 2008-11-12 vale', async () => {
    const { userId, token } = await pendingBeto(t);
    t.clock.set('2026-11-11T23:30:00.000Z');
    expect((await review(token, { birthDate: '2008-11-12' })).status).toBe(204);
    expect((await userRow(userId))?.birthDate).toBe('2008-11-12');
  });

  it('C3-4: con 2008-11-13 → 422 UNDERAGE, la cuenta ya no existe y la fecha no sale en los logs', async () => {
    const { userId, token } = await pendingBeto(t);
    t.clock.set('2026-11-11T23:30:00.000Z');
    const output: string[] = [];
    const capture = (chunk: unknown): boolean => {
      output.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(capture);
    vi.spyOn(process.stderr, 'write').mockImplementation(capture);
    const response = await review(token, { birthDate: '2008-11-13' });
    vi.restoreAllMocks();

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('UNDERAGE');
    expect(await userRow(userId)).toBeUndefined();
    expect(await rowsReferencingUser(t, userId)).toBe(0);
    expect(output.join('')).not.toContain('2008-11-13');
    expect(output.join('')).not.toContain('2008');
    // La sesión ya no vale.
    expect(
      (await api(t.app).get('/auth/session').set('Authorization', `Bearer ${token}`)).status,
    ).toBe(401);
  });

  it('menor con la casilla sin marcar (o ausente): la cuenta se borra y no se registra ningún consentimiento', async () => {
    for (const acceptTerms of [false, undefined]) {
      await truncateAll(t.db);
      resetRateLimits(t.app);
      inbox(t.app).clear();
      const { userId, token } = await pendingBeto(t);
      const response = await review(token, { birthDate: '2015-03-04', acceptTerms });
      expect(response.status, String(acceptTerms)).toBe(422);
      expect(response.body.error.code).toBe('UNDERAGE');
      expect(await userRow(userId)).toBeUndefined();
      expect(await consentsOf(userId)).toEqual([]);
    }
  });

  it('adulto con la casilla sin marcar → 400 acceptTerms: required, sin consentimiento nuevo y con la revisión pendiente', async () => {
    const { userId, token } = await pendingBeto(t);
    const before = { user: await userRow(userId), consents: await consentsOf(userId) };
    for (const acceptTerms of [false, undefined]) {
      const response = await review(token, { acceptTerms });
      expect(response.status, String(acceptTerms)).toBe(400);
      expect(response.body.error.fields).toEqual([{ path: 'acceptTerms', issue: 'required' }]);
    }
    expect(await userRow(userId)).toEqual(before.user);
    expect(await consentsOf(userId)).toEqual(before.consents);
  });

  it('C3-5: fecha futura → 400 in_future; versión antigua → 409; no cambia nada', async () => {
    const { userId, token } = await pendingBeto(t);
    const before = { user: await userRow(userId), consents: await consentsOf(userId) };

    const future = await review(token, { birthDate: '2027-01-01' });
    expect(future.status).toBe(400);
    expect(future.body.error.fields).toEqual([{ path: 'birthDate', issue: 'in_future' }]);
    const outdated = await review(token, { termsVersion: '2026-11-borrador' });
    expect(outdated.status).toBe(409);
    expect(outdated.body.error.code).toBe('TERMS_VERSION_OUTDATED');

    expect(await userRow(userId)).toEqual(before.user);
    expect(await consentsOf(userId)).toEqual(before.consents);
  });

  it('C3-6: Ana, sin revisión pendiente → 404 y su fecha no cambia', async () => {
    const ana = await registerUser(t.app, { email: ANA, password: TEST_PASSWORD });
    const response = await review(ana.token, { birthDate: '1985-01-20' });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect((await userRow(ana.userId))?.birthDate).toBe('1990-05-05');
    expect(await consentsOf(ana.userId)).toHaveLength(1);
  });

  it('C3-6: un menor sin revisión pendiente da 422 y no se borra nada', async () => {
    const ana = await registerUser(t.app, { email: ANA, password: TEST_PASSWORD });
    const response = await review(ana.token, { birthDate: '2015-01-01' });
    expect(response.status).toBe(422);
    expect(await userRow(ana.userId)).toBeDefined();
  });

  it('C3-7: pendiente, borrar la cuenta con la contraseña nueva → 204', async () => {
    const { userId, token } = await pendingBeto(t);
    const response = await api(t.app)
      .post('/users/me/deletion')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: NEW_PASSWORD });
    expect(response.status).toBe(204);
    expect(await userRow(userId)).toBeUndefined();
  });

  it('C3-8: pendiente, volver a entrar trae dataReviewRequired y la revisión sigue pendiente', async () => {
    const { userId } = await pendingBeto(t);
    const response = await api(t.app)
      .post('/auth/login')
      .send({ email: BETO, password: NEW_PASSWORD });
    expect(response.status).toBe(200);
    expect(response.body.user.dataReviewRequired).toBe(true);
    expect((await userRow(userId))?.dataReviewRequiredAt).not.toBeNull();
    // Y la sesión nueva sigue bloqueada.
    const oauth = await connectGoogle(response.body.session.token as string);
    expect(oauth.body.error.code).toBe('DATA_REVIEW_REQUIRED');
  });

  it('confirmar con contraseña o entrar no ponen la marca: solo el restablecimiento', async () => {
    const { userId, link } = await registerBeto(t.app, t.db);
    await loginToken(t.app, BETO);
    expect(
      (
        await api(t.app)
          .post('/auth/email-verification')
          .send({ token: link, password: TEST_PASSWORD })
      ).status,
    ).toBe(200);
    expect((await userRow(userId))?.dataReviewRequiredAt).toBeNull();
  });
});
