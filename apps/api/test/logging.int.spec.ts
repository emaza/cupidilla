import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashSessionToken } from '../src/auth/sessions.service.js';
import {
  api,
  createTestApp,
  registerBody,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

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

    const registered = await api(t.app).post('/auth/register').send(adult);
    expect(registered.status).toBe(201);
    const token = registered.body.session.token as string;

    expect((await api(t.app).post('/auth/register').send(minor)).status).toBe(422);
    expect(
      (
        await api(t.app)
          .post('/auth/login')
          .send({ email: adult.email, password: 'contraseña-fallida-x' })
      ).status,
    ).toBe(401);
    expect((await api(t.app).post('/auth/register').send(adult)).status).toBe(409);
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
      hashSessionToken(token),
      registered.body.user.id as string,
      process.env.INTERNAL_API_KEY ?? 'clave-interna',
      '$argon2id$',
    ];
    for (const value of forbidden) {
      expect(log, `el log contiene «${value}»`).not.toContain(value);
    }
  });
});
