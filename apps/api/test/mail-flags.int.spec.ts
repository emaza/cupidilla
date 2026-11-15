import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Las variables se leen al cargar el módulo de la aplicación: van antes de cualquier import.
vi.hoisted(() => {
  process.env.EMAIL_UNVERIFIED_REMINDER = 'false';
  delete process.env.EMAIL_PASSWORD_CHANGED_NOTICE;
  delete process.env.MIN_AGE;
});

const { configResponseSchema } = await import('@cupidilla/contracts');
const { UnverifiedAccountsSweeper } = await import('../src/users/unverified-accounts.sweeper.js');
const { registerBeto, inbox } = await import('./helpers/mail.js');
const { api, countRows, createTestApp, TEST_NOW, truncateAll } =
  await import('./helpers/test-app.js');
type TestApp = Awaited<ReturnType<typeof createTestApp>>;

describe('EMAIL_UNVERIFIED_REMINDER=false', () => {
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

  it('B4-0: GET /config, sin sesión, da minAge 18 y los dos interruptores; sin clave interna, 403', async () => {
    const response = await api(t.app).get('/config');
    expect(response.status).toBe(200);
    expect(configResponseSchema.parse(response.body)).toEqual({
      minAge: 18,
      mail: { unverifiedReminder: false, passwordChangedNotice: true },
    });
    expect((await request(t.app.getHttpServer()).get('/config')).status).toBe(403);
  });

  it('B5-3: a los 5 días no se encola ningún recordatorio', async () => {
    await registerBeto(t.app, t.db);
    t.clock.set('2026-11-16T10:00:00Z');
    const result = await t.app.get(UnverifiedAccountsSweeper).sweep();
    expect(result).toEqual({ deleted: 0, reminded: 0 });
    expect(await countRows(t.db, 'email_outbox')).toBe(0);
  });
});
