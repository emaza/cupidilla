import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnverifiedAccountsSweeper } from '../src/users/unverified-accounts.sweeper.js';
import {
  ANA,
  BETO,
  CARLA_FB,
  deliverMail,
  inbox,
  mailRegisterBody,
  NADIE,
  registerBeto,
  seedCarla,
  TEST_PASSWORD,
} from './helpers/mail.js';
import {
  api,
  createTestApp,
  registerUser,
  resetRateLimits,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

/** B9-1 (correo §10, R-M13): los logs de los flujos de B2 a B5 no llevan secretos ni correos. */
describe('B9-1: logs de la verificación del correo', () => {
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
    resetRateLimits(t.app);
    inbox(t.app).clear();
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

  it('registro, aviso, comprobación, fallos, confirmación, reenvío, recordatorio y borrado', async () => {
    const register = (email: string) =>
      api(t.app).post('/auth/register').send(mailRegisterBody(email));
    const confirm = (token: string, password?: string, bearer?: string) => {
      const req = api(t.app).post('/auth/email-verification');
      if (bearer) req.set('Authorization', `Bearer ${bearer}`);
      return req.send({ token, ...(password ? { password } : {}) });
    };

    // B2: registro con correos nuevos y existentes.
    const ana = await registerUser(t.app, { email: ANA, password: TEST_PASSWORD });
    await seedCarla(t.db);
    const { link } = await registerBeto(t.app, t.db);
    for (const email of [NADIE, ANA, BETO, CARLA_FB]) await register(email);
    await deliverMail(t.app);

    // B3: comprobar, fallar, confirmar con la sesión de otra cuenta y reenviar.
    await api(t.app)
      .post('/auth/email-tokens/inspection')
      .send({ token: link, purpose: 'verify_email' });
    await confirm(link, 'contraseña-equivocada');
    await api(t.app).post('/auth/email-verification/request').send({ email: BETO });
    await deliverMail(t.app);

    // B5: recordatorio y borrado de la cuenta de Nadie (sin confirmar).
    const sweeper = t.app.get(UnverifiedAccountsSweeper);
    t.clock.set('2026-11-16T10:00:00Z');
    await sweeper.sweep();
    await deliverMail(t.app);
    const betoLinks = inbox(t.app)
      .messagesTo(BETO)
      .map((message) => inbox(t.app).linkIn(message, '/verify-email'))
      .filter((token): token is string => token !== undefined);
    const latest = betoLinks.at(-1)!;
    expect((await confirm(latest, TEST_PASSWORD, ana.token)).body.session).toBe('kept-other');
    t.clock.set('2026-11-18T10:01:00Z');
    expect((await sweeper.sweep()).deleted).toBe(1);

    vi.restoreAllMocks();
    const log = output.join('');
    // Se ha registrado algo: el test no pasa por no capturar nada.
    for (const event of [
      'mail_sent',
      'email_verified',
      'unverified_reminders_enqueued',
      'unverified_accounts_deleted',
      '"route":"/auth/email-verification"',
    ]) {
      expect(log).toContain(event);
    }

    const tokens = inbox(t.app)
      .messages.flatMap((message) => [
        inbox(t.app).linkIn(message, '/verify-email'),
        inbox(t.app).linkIn(message, '/reset-password'),
      ])
      .filter((token): token is string => token !== undefined);
    expect(tokens.length).toBeGreaterThanOrEqual(3);
    const forbidden = [
      ...tokens,
      '/verify-email?token=',
      'http://localhost:5173',
      BETO,
      ANA,
      NADIE,
      CARLA_FB,
      'b•••@example.com',
      TEST_PASSWORD,
      'contraseña-equivocada',
      'smtp://',
      ana.token,
    ];
    for (const value of forbidden) {
      expect(log, `el log contiene «${value}»`).not.toContain(value);
    }
  });
});
