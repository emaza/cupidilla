import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Las variables se leen al cargar el módulo de la aplicación: van antes de cualquier import.
vi.hoisted(() => {
  process.env.CAPTCHA_ENABLED = 'true';
  process.env.CAPTCHA_HMAC_KEY = 'test-captcha-hmac-key-0123456789abcdef';
  process.env.CAPTCHA_DIFFICULTY = 'minimal';
});

const { captchaChallengeSchema, configResponseSchema } = await import('@cupidilla/contracts');
const { CAPTCHA_TEST_ENV, encodeCaptcha, resetCaptcha, solveCaptcha } =
  await import('./helpers/captcha.js');
const { contactBody, contactRows, CONTACT_NOW } = await import('./helpers/contact.js');
const { deliverMail, inbox } = await import('./helpers/mail.js');
const { api, countRows, createTestApp, registerBody, resetRateLimits, truncateAll, uniqueIp } =
  await import('./helpers/test-app.js');
type TestApp = Awaited<ReturnType<typeof createTestApp>>;

/**
 * Comprobación antibots activada (técnico de captcha §13: CA4–CA13, CA24 y CA25), con la
 * dificultad mínima y la clave de pruebas.
 */
describe('CAPTCHA_ENABLED=true', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ now: CONTACT_NOW });
  });
  afterAll(async () => {
    await t.app.close();
    // Lo que fija vitest.config.ts para el resto de archivos.
    process.env.CAPTCHA_ENABLED = 'false';
    process.env.CAPTCHA_HMAC_KEY = '';
    process.env.CAPTCHA_DIFFICULTY = '';
  });
  beforeEach(async () => {
    await truncateAll(t.db);
    resetRateLimits(t.app);
    resetCaptcha(t.app);
    inbox(t.app).clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Lo que se escribe en stdout y stderr mientras corre `action`. */
  async function captureLogs(action: () => Promise<void>): Promise<string> {
    const output: string[] = [];
    const capture = (chunk: unknown): boolean => {
      output.push(String(chunk));
      return true;
    };
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(capture);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(capture);
    try {
      await action();
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
    return output.join('');
  }

  const register = (body: unknown, captcha?: string, ip = uniqueIp()) => {
    const test = api(t.app, ip).post('/auth/register');
    return (captcha === undefined ? test : test.set('X-Captcha', captcha)).send(body as object);
  };

  /** Solución válida descompuesta, para alterarla. */
  async function solvedParts() {
    const header = await solveCaptcha(t.app);
    return JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as {
      challenge: { parameters: Record<string, unknown>; signature: string };
      solution: { counter: number; derivedKey: string; time?: number };
    };
  }

  it('GET /config dice captcha.enabled = true y la dirección de soporte', async () => {
    const config = configResponseSchema.parse((await api(t.app).get('/config')).body);
    expect(config.captcha).toEqual({ enabled: true });
    expect(config.support).toEqual({ email: 'soporte@example.com' });
  });

  it('CA4: GET /captcha/challenge da un reto PBKDF2 mínimo, sin campos de más y no-store', async () => {
    const before = Math.floor(Date.now() / 1000);
    const response = await api(t.app).get('/captcha/challenge');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const challenge = captchaChallengeSchema.parse(response.body);
    expect(Object.keys(response.body as object).sort()).toEqual(['parameters', 'signature']);
    expect(challenge.parameters.algorithm).toBe('PBKDF2/SHA-256');
    expect(challenge.parameters.cost).toBe(1);
    expect(challenge.parameters.expiresAt).toBeGreaterThanOrEqual(before + 599);
    expect(challenge.parameters.expiresAt).toBeLessThanOrEqual(before + 601);
    for (const field of ['codeChallenge', 'configuration'])
      expect(response.body).not.toHaveProperty(field);
    expect(challenge.parameters).not.toHaveProperty('data');
    const other = captchaChallengeSchema.parse((await api(t.app).get('/captcha/challenge')).body);
    expect(other.parameters.nonce).not.toBe(challenge.parameters.nonce);
  });

  it('CA5: registro con una solución válida da 202; la misma otra vez, CAPTCHA_INVALID (replayed) sin la cabecera en los logs', async () => {
    const captcha = await solveCaptcha(t.app);
    expect((await register(registerBody(), captcha)).status).toBe(202);
    expect(await countRows(t.db, 'users')).toBe(1);

    let response: Awaited<ReturnType<typeof register>> | undefined;
    const logs = await captureLogs(async () => {
      response = await register(registerBody(), captcha);
    });
    expect(response?.status).toBe(400);
    expect(response?.body.error.code).toBe('CAPTCHA_INVALID');
    expect(await countRows(t.db, 'users')).toBe(1);
    expect(logs).toContain('captcha_rejected');
    expect(logs).toContain('"reason":"replayed"');
    expect(logs).toContain('"route":"/auth/register"');
    // CA24: ni la cabecera, ni el reto, ni la IP.
    expect(logs).not.toContain(captcha.slice(0, 40));
    expect(logs).not.toMatch(/nonce|derivedKey|10\.\d+\.\d+\.\d+/);
  });

  it('CA6: 4 registros sin X-Captcha dan CAPTCHA_REQUIRED y no gastan el cupo; el 5.º, con solución, 202', async () => {
    const ip = uniqueIp();
    const body = registerBody({ email: 'ana@example.com' });
    for (let n = 0; n < 4; n += 1) {
      const response = await register(body, undefined, ip);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('CAPTCHA_REQUIRED');
    }
    expect(await countRows(t.db, 'users')).toBe(0);
    expect((await register(body, await solveCaptcha(t.app), ip)).status).toBe(202);
  });

  it('CA7: cost cambiado (firma igual) y derivedKey cambiado dan CAPTCHA_INVALID', async () => {
    const tampered = await solvedParts();
    tampered.challenge.parameters.cost = 2;
    const wrongKey = await solvedParts();
    const key = wrongKey.solution.derivedKey;
    wrongKey.solution.derivedKey = (key.startsWith('0') ? '1' : '0') + key.slice(1);

    let responses: Awaited<ReturnType<typeof register>>[] = [];
    const logs = await captureLogs(async () => {
      responses = [
        await register(registerBody(), encodeCaptcha(tampered)),
        await register(registerBody(), encodeCaptcha(wrongKey)),
      ];
    });
    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('CAPTCHA_INVALID');
    }
    expect(logs).toContain('"reason":"signature"');
    expect(logs).toContain('"reason":"solution"');
    expect(await countRows(t.db, 'users')).toBe(0);
  });

  it('CA8: recuperación con el reloj adelantado 601 s da CAPTCHA_INVALID (expired); con 599 s, 202', async () => {
    const late = await solveCaptcha(t.app);
    const inTime = await solveCaptcha(t.app);
    const start = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    const reset = (captcha: string) =>
      api(t.app)
        .post('/auth/password-reset/request')
        .set('X-Captcha', captcha)
        .send({ email: 'ana@example.com' });

    vi.setSystemTime(start + 599_000);
    expect((await reset(inTime)).status).toBe(202);
    vi.setSystemTime(start + 601_000);
    const logs = await captureLogs(async () => {
      const response = await reset(late);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('CAPTCHA_INVALID');
    });
    expect(logs).toContain('"reason":"expired"');
  });

  const ROUTES = [
    ['/auth/register', () => registerBody()],
    ['/auth/password-reset/request', () => ({ email: 'ana@example.com' })],
    ['/auth/email-verification/request', () => ({ email: 'ana@example.com' })],
    ['/contact', () => contactBody()],
  ] as const;

  it.each(ROUTES)(
    'CA9: %s con X-Captcha mal formada da CAPTCHA_INVALID, nunca 500',
    async (path, body) => {
      const v1 = encodeCaptcha({
        algorithm: 'SHA-256',
        challenge: 'ab',
        number: 1,
        salt: 'cd',
        signature: 'ef',
        took: 1,
      });
      const headers: string[] = [
        'abc',
        Buffer.from('{').toString('base64'),
        encodeCaptcha({ challenge: null, solution: null, test: true }),
        'A'.repeat(5000),
        v1,
        // La cabecera repetida: Node junta los valores con «, » (y supertest no envía dos).
        `${await solveCaptcha(t.app)}, ${await solveCaptcha(t.app)}`,
      ];
      for (const header of headers) {
        const response = await api(t.app).post(path).set('X-Captcha', header).send(body());
        expect(response.status, String(header).slice(0, 20)).toBe(400);
        expect(response.body.error.code).toBe('CAPTCHA_INVALID');
      }
      expect(await countRows(t.db, 'email_outbox')).toBe(0);
    },
  );

  it.each(ROUTES)('%s sin X-Captcha da CAPTCHA_REQUIRED y no escribe nada', async (path, body) => {
    const response = await api(t.app).post(path).send(body());
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('CAPTCHA_REQUIRED');
    expect(await countRows(t.db, 'email_outbox')).toBe(0);
  });

  it('el reenvío de la verificación con una solución válida da 202', async () => {
    const response = await api(t.app)
      .post('/auth/email-verification/request')
      .set('X-Captcha', await solveCaptcha(t.app))
      .send({ email: 'ana@example.com' });
    expect(response.status).toBe(202);
  });

  it('CA10 y CA25: login, /config y los proveedores OAuth no piden comprobación', async () => {
    const login = await api(t.app)
      .post('/auth/login')
      .send({ email: 'nadie@example.com', password: 'una-contraseña-cualquiera' });
    expect(login.status).toBe(401);
    expect(login.body.error.code).toBe('INVALID_CREDENTIALS');
    expect((await api(t.app).get('/config')).status).toBe(200);
    expect((await api(t.app).get('/auth/oauth/providers')).status).toBe(200);
  });

  it('CA11: contacto sin X-Captcha (nada guardado), con solución (guardado) y con solución y trampa (nada)', async () => {
    const without = await api(t.app).post('/contact').send(contactBody());
    expect(without.status).toBe(400);
    expect(without.body.error.code).toBe('CAPTCHA_REQUIRED');
    expect(await contactRows(t.db)).toEqual([]);

    const trap = await api(t.app)
      .post('/contact')
      .set('X-Captcha', await solveCaptcha(t.app))
      .send(contactBody({ hp_contact: 'http://spam.example' }));
    expect(trap.status).toBe(202);
    expect(await contactRows(t.db)).toEqual([]);

    const valid = await api(t.app)
      .post('/contact')
      .set('X-Captcha', await solveCaptcha(t.app))
      .send(contactBody());
    expect(valid.status).toBe(202);
    expect(await contactRows(t.db)).toHaveLength(1);
    expect(await deliverMail(t.app)).toMatchObject({ sent: 1 });
  });

  it('CA12: el reto 31.º de una IP en 15 minutos da 429 con Retry-After', async () => {
    const ip = uniqueIp();
    for (let n = 0; n < 30; n += 1) {
      expect((await api(t.app, ip).get('/captcha/challenge')).status).toBe(200);
    }
    const response = await api(t.app, ip).get('/captcha/challenge');
    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe('RATE_LIMITED');
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('CA13: dos registros simultáneos con la misma solución: uno 202 y otro CAPTCHA_INVALID', async () => {
    const captcha = await solveCaptcha(t.app);
    const responses = await Promise.all([
      register(registerBody(), captcha),
      register(registerBody(), captcha),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([202, 400]);
    expect(responses.find((response) => response.status === 400)?.body.error.code).toBe(
      'CAPTCHA_INVALID',
    );
    expect(await countRows(t.db, 'users')).toBe(1);
  });

  it('las variables de prueba son las de helpers/captcha.ts', () => {
    expect(process.env.CAPTCHA_HMAC_KEY).toBe(CAPTCHA_TEST_ENV.CAPTCHA_HMAC_KEY);
  });
});
