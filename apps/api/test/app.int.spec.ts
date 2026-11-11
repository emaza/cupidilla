import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, type TestApp } from './helpers/test-app.js';

describe('Infraestructura común', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('I-13: sin clave interna, o con una errónea → 403 FORBIDDEN; /health responde sin clave', async () => {
    const server = t.app.getHttpServer();
    const withoutKey = await request(server).post('/auth/login').send({});
    expect(withoutKey.status).toBe(403);
    expect(withoutKey.body.error.code).toBe('FORBIDDEN');

    const wrongKey = await request(server)
      .get('/users/me')
      .set('X-Internal-Api-Key', 'clave-equivocada-de-mas-de-32-caracteres');
    expect(wrongKey.status).toBe(403);
    expect(wrongKey.body).toEqual({
      error: { code: 'FORBIDDEN', message: 'Missing or invalid internal API key' },
    });

    const health = await request(server).get('/health');
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: 'ok' });
  });

  it('I-19: JSON ilegible o de más de 16 kB → 400 MALFORMED_REQUEST', async () => {
    const unreadable = await api(t.app)
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    expect(unreadable.status).toBe(400);
    expect(unreadable.body).toEqual({
      error: { code: 'MALFORMED_REQUEST', message: 'Malformed request body' },
    });

    const tooLarge = await api(t.app)
      .post('/auth/login')
      .send({ email: 'a@example.com', password: 'x'.repeat(17 * 1024) });
    expect(tooLarge.status).toBe(400);
    expect(tooLarge.body.error.code).toBe('MALFORMED_REQUEST');
  });

  it('I-20: ruta inexistente → 404 NOT_FOUND con la forma única de error', async () => {
    const response = await api(t.app).get('/no-existe');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
