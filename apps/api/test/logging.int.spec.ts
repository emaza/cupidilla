import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashOpaqueToken } from '../src/common/crypto/opaque-token.js';
import { NO_ROUTE } from '../src/common/logging/request-logging.middleware.js';
import {
  api,
  createTestApp,
  registerBody,
  registerUser,
  TEST_NOW,
  truncateAll,
  uniqueIp,
  type TestApp,
} from './helpers/test-app.js';

interface RequestLog {
  method: string;
  route: string;
  status: number;
  ms: number;
}

/** Entradas del log de peticiones (contexto HTTP) en la salida JSON capturada. */
function requestLogs(output: string[]): RequestLog[] {
  return output
    .join('')
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => JSON.parse(line) as { context?: string; message?: unknown })
    .filter((entry) => entry.context === 'HTTP')
    .map((entry) => entry.message as RequestLog);
}

describe('Los logs no contienen datos personales ni secretos (I-21)', () => {
  let t: TestApp;
  let output: string[];

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await truncateAll(t.db);
    t.clock.set(TEST_NOW);
    output = [];
    const capture = (chunk: unknown): boolean => {
      output.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(capture);
    vi.spyOn(process.stderr, 'write').mockImplementation(capture);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registro, menor, login fallido, correo repetido y borrado', async () => {
    const adult = registerBody({
      email: 'secreta.persona@example.com',
      password: 'contraseña-muy-secreta',
      birthDate: '1987-03-14',
    });
    const minor = registerBody({
      email: 'menor.secreto@example.com',
      password: 'otra-contraseña-secreta',
      birthDate: '2010-06-21',
    });

    const registered = await registerUser(t.app, adult);
    const token = registered.token;

    expect((await api(t.app).post('/auth/register').send(minor)).status).toBe(422);
    expect(
      (
        await api(t.app)
          .post('/auth/login')
          .send({ email: adult.email, password: 'contraseña-fallida-x' })
      ).status,
    ).toBe(401);
    // Registro uniforme (correo §5.1): el correo repetido también es 202.
    expect((await api(t.app).post('/auth/register').send(adult)).status).toBe(202);
    const deleted = await api(t.app)
      .post('/users/me/deletion')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: adult.password });
    expect(deleted.status).toBe(204);

    vi.restoreAllMocks();
    const log = output.join('');

    // Se ha registrado algo: el test no pasa por no capturar nada.
    expect(log).toContain('"route":"/auth/register"');
    expect(log).toContain('account_deleted');

    const forbidden = [
      adult.email,
      minor.email,
      adult.password,
      minor.password,
      'contraseña-fallida-x',
      adult.birthDate,
      minor.birthDate,
      token,
      hashOpaqueToken(token),
      registered.userId,
      process.env.INTERNAL_API_KEY ?? 'clave-interna',
      '$argon2id$',
    ];
    for (const value of forbidden) {
      expect(log, `el log contiene «${value}»`).not.toContain(value);
    }
  });

  it('las respuestas de guards y parsers (403, 401, 429, 400, 404) también se registran, sin la URL real', async () => {
    const server = t.app.getHttpServer();
    const secretQuery = 'correo=consulta.secreta%40example.com';

    // 403: sin clave interna (lo corta InternalKeyGuard).
    expect((await request(server).get(`/users/me?${secretQuery}`)).status).toBe(403);
    // 401: sin sesión (lo corta SessionGuard).
    expect((await api(t.app).get(`/users/me?${secretQuery}`)).status).toBe(401);
    // 429: el 6.º login con el mismo correo (lo corta AppThrottlerGuard).
    const login = { email: 'limite.secreto@example.com', password: 'contraseña-fallida-x' };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await api(t.app, uniqueIp()).post(`/auth/login?${secretQuery}`).send(login);
    }
    expect((await api(t.app).post(`/auth/login?${secretQuery}`).send(login)).status).toBe(429);
    // 400: JSON ilegible (lo corta el body parser, antes de que haya ruta).
    const malformed = await api(t.app)
      .post(`/auth/login?${secretQuery}`)
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    expect(malformed.status).toBe(400);
    // 404: ninguna ruta coincide.
    expect((await api(t.app).get(`/no-existe/id-secreto-987?${secretQuery}`)).status).toBe(404);

    vi.restoreAllMocks();
    const logs = requestLogs(output);
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'GET', route: '/users/me', status: 403 }),
        expect.objectContaining({ method: 'GET', route: '/users/me', status: 401 }),
        expect.objectContaining({ method: 'POST', route: '/auth/login', status: 429 }),
        expect.objectContaining({ method: 'POST', route: NO_ROUTE, status: 400 }),
        expect.objectContaining({ method: 'GET', route: NO_ROUTE, status: 404 }),
      ]),
    );
    for (const entry of logs) expect(typeof entry.ms).toBe('number');

    const log = output.join('');
    for (const value of [
      'consulta.secreta',
      secretQuery,
      '/no-existe',
      'id-secreto-987',
      login.email,
    ]) {
      expect(log, `el log contiene «${value}»`).not.toContain(value);
    }
  });
});
