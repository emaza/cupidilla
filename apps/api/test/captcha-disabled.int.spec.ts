import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configResponseSchema } from '@cupidilla/contracts';
import { api, createTestApp, registerBody, type TestApp } from './helpers/test-app.js';

/** CA1 (API): con CAPTCHA_ENABLED=false, que es lo que fija vitest.config.ts. */
describe('CAPTCHA_ENABLED=false', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('GET /captcha/challenge da 404, /config lo dice y el registro no la pide', async () => {
    const challenge = await api(t.app).get('/captcha/challenge');
    expect(challenge.status).toBe(404);
    expect(challenge.body.error.code).toBe('NOT_FOUND');
    expect(configResponseSchema.parse((await api(t.app).get('/config')).body).captcha).toEqual({
      enabled: false,
    });
    expect((await api(t.app).post('/auth/register').send(registerBody())).status).toBe(202);
  });
});
