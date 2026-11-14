import { configResponseSchema } from '@cupidilla/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, type TestApp } from './helpers/test-app.js';

describe('GET /config (edad mínima por defecto)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('sin MIN_AGE devuelve { minAge: 18 }, sin sesión pero con la clave interna', async () => {
    const response = await api(t.app).get('/config');
    expect(response.status).toBe(200);
    expect(configResponseSchema.parse(response.body)).toEqual({
      minAge: 18,
      mail: { unverifiedReminder: true, passwordChangedNotice: true },
    });
  });

  it('sin clave interna → 403 FORBIDDEN', async () => {
    const response = await request(t.app.getHttpServer()).get('/config');
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });
});
