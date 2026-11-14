import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Las variables se leen al cargar el módulo de la aplicación: van antes de cualquier import.
vi.hoisted(() => {
  process.env.EMAIL_PASSWORD_CHANGED_NOTICE = 'false';
});

const { ANA, deliverMail, inbox, linkTo, TEST_PASSWORD } = await import('./helpers/mail.js');
const { api, countRows, createTestApp, registerUser, TEST_NOW, truncateAll } =
  await import('./helpers/test-app.js');
type TestApp = Awaited<ReturnType<typeof createTestApp>>;

describe('EMAIL_PASSWORD_CHANGED_NOTICE=false', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await truncateAll(t.db);
    inbox(t.app).clear();
    t.clock.set(TEST_NOW);
  });

  it('C2-3: Ana restablece y no recibe «Tu contraseña ha cambiado»', async () => {
    await registerUser(t.app, { email: ANA, password: TEST_PASSWORD });
    expect(
      (await api(t.app).post('/auth/password-reset/request').send({ email: ANA })).status,
    ).toBe(202);
    await deliverMail(t.app);
    const token = linkTo(t.app, ANA, '/reset-password');
    inbox(t.app).clear();

    const response = await api(t.app)
      .post('/auth/password-reset')
      .send({ token, password: 'otra frase larga nueva' });
    expect(response.status).toBe(200);
    expect(await countRows(t.db, 'email_outbox')).toBe(0);
    await deliverMail(t.app);
    expect(inbox(t.app).messages).toEqual([]);
  });
});
