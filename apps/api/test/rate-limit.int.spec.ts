import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  createTestApp,
  registerBody,
  registerUser,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

describe('Límite de intentos (I-11)', () => {
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

  it('el 6.º login con el mismo correo en 15 minutos → 429 con Retry-After, aunque cambie la IP', async () => {
    const user = await registerUser(t.app);
    for (let attempt = 1; attempt <= 5; attempt++) {
      const response = await api(t.app)
        .post('/auth/login')
        .send({ email: user.email, password: 'contraseña-errónea' });
      expect(response.status).toBe(401);
    }
    const blocked = await api(t.app)
      .post('/auth/login')
      .send({ email: ` ${user.email.toUpperCase()} `, password: user.password });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      error: { code: 'RATE_LIMITED', message: 'Too many requests' },
    });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('el 6.º registro desde la misma IP en una hora → 429', async () => {
    const sameIp = api(t.app, '192.0.2.10');
    for (let attempt = 1; attempt <= 5; attempt++) {
      const response = await sameIp.post('/auth/register').send(registerBody());
      expect(response.status).toBe(201);
    }
    const blocked = await sameIp.post('/auth/register').send(registerBody());
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('el 6.º intento de borrado con la misma sesión en 15 minutos → 429', async () => {
    const user = await registerUser(t.app);
    for (let attempt = 1; attempt <= 5; attempt++) {
      const response = await api(t.app)
        .post('/users/me/deletion')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ password: 'contraseña-errónea' });
      expect(response.status).toBe(403);
    }
    const blocked = await api(t.app)
      .post('/users/me/deletion')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ password: user.password });
    expect(blocked.status).toBe(429);
  });
});
