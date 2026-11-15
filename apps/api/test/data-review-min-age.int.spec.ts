import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Las variables se leen al cargar el módulo de la aplicación: van antes de cualquier import.
vi.hoisted(() => {
  process.env.MIN_AGE = '21';
});

const { SERVICE_TERMS_VERSION } = await import('@cupidilla/contracts');
const { eq } = await import('drizzle-orm');
const { users } = await import('../src/database/schema/index.js');
const { PasswordService } = await import('../src/users/password.service.js');
const { pendingBeto, rowsReferencingUser } = await import('./helpers/data-review.js');
const { ANA, inbox, TEST_PASSWORD } = await import('./helpers/mail.js');
const { api, createTestApp, resetRateLimits, TEST_NOW, truncateAll } =
  await import('./helpers/test-app.js');
type TestApp = Awaited<ReturnType<typeof createTestApp>>;

/** C3-4b: la revisión aplica el MIN_AGE vigente; las cuentas que no la pasan se respetan. */
describe('C3-4b: revisión de datos con MIN_AGE=21', () => {
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

  const review = (token: string, birthDate: string, acceptTerms: boolean | undefined = true) =>
    api(t.app)
      .post('/users/me/data-review')
      .set('Authorization', `Bearer ${token}`)
      .send({ birthDate, acceptTerms, termsVersion: SERVICE_TERMS_VERSION });

  /** Ana, creada antes de subir MIN_AGE, con 20 años y el correo verificado. */
  async function seedAna(): Promise<void> {
    const createdAt = new Date('2026-10-01T10:00:00.000Z');
    await t.db.insert(users).values({
      email: ANA,
      passwordHash: await t.app.get(PasswordService).hash(TEST_PASSWORD),
      birthDate: '2006-01-01',
      emailVerifiedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    });
  }

  it('2005-11-11 (cumple 21 hoy) → 204', async () => {
    const { token } = await pendingBeto(t);
    expect((await review(token, '2005-11-11')).status).toBe(204);
  });

  it('QA: la web (con MIN_AGE 18 en caché) envía la casilla sin marcar para alguien de 20 años: la API lo trata como menor, borra la cuenta y no registra ningún consentimiento', async () => {
    const { userId, token } = await pendingBeto(t);
    const response = await review(token, '2006-01-01', false);
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('UNDERAGE');
    expect(await t.db.select().from(users).where(eq(users.id, userId))).toEqual([]);
    expect(await rowsReferencingUser(t, userId)).toBe(0);
  });

  it('QA: alguien de 22 años con la casilla sin marcar → 400 acceptTerms: required y nada cambia', async () => {
    const { userId, token } = await pendingBeto(t);
    const response = await review(token, '2004-01-01', false);
    expect(response.status).toBe(400);
    expect(response.body.error.fields).toEqual([{ path: 'acceptTerms', issue: 'required' }]);
    const [row] = await t.db.select().from(users).where(eq(users.id, userId));
    expect(row?.dataReviewRequiredAt).not.toBeNull();
    expect(row?.birthDate).toBe('1990-05-05');
  });

  it('2005-11-12 (cumple 21 mañana) → 422 y la cuenta se borra; Ana, que no pasa por la revisión, sigue entrando', async () => {
    await seedAna();
    const { userId, token } = await pendingBeto(t);
    const output: string[] = [];
    const capture = (chunk: unknown): boolean => {
      output.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(capture);
    vi.spyOn(process.stderr, 'write').mockImplementation(capture);
    const response = await review(token, '2005-11-12');
    vi.restoreAllMocks();

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('UNDERAGE');
    expect(await t.db.select().from(users).where(eq(users.id, userId))).toEqual([]);
    expect(await rowsReferencingUser(t, userId)).toBe(0);
    expect(output.join('')).not.toContain('2005-11-12');

    const login = await api(t.app)
      .post('/auth/login')
      .send({ email: ANA, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
  });
});
