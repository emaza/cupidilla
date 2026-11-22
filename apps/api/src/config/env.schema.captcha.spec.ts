import { describe, expect, it } from 'vitest';
import { envSchema } from './env.schema.js';

/** Configuración de la comprobación antibots (técnico de captcha §5.1, CA2 y CA3). */
const KEY = 'c'.repeat(32);
const base = {
  DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/cupidilla',
  INTERNAL_API_KEY: 'k'.repeat(32),
  PUBLIC_WEB_URL: 'http://localhost:5173',
  NODE_ENV: 'test',
};
const production = {
  ...base,
  NODE_ENV: 'production',
  PUBLIC_WEB_URL: 'https://cupidilla.es',
  SMTP_URL: 'smtps://usuario:clave@smtp.proveedor.eu',
  MAIL_FROM: 'Cupidilla <no-reply@cupidilla.es>',
  MAIL_SUPPORT_ADDRESS: 'soporte@cupidilla.es',
  CONTACT_TO_ADDRESS: 'contacto@cupidilla.es',
};

function problems(env: Record<string, string | undefined>): string[] {
  const result = envSchema.safeParse(env);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

describe('CAPTCHA_ENABLED, CAPTCHA_HMAC_KEY y CAPTCHA_DIFFICULTY', () => {
  it('CA2: activada por defecto; sin clave (o vacía) no arranca y explica cómo desactivarla', () => {
    for (const key of [undefined, '']) {
      const found = problems({ ...base, CAPTCHA_HMAC_KEY: key });
      expect(found).toHaveLength(1);
      expect(found[0]).toContain('CAPTCHA_HMAC_KEY');
      expect(found[0]).toContain('CAPTCHA_ENABLED=false');
    }
    expect(envSchema.parse({ ...base, CAPTCHA_ENABLED: 'false' })).toMatchObject({
      CAPTCHA_ENABLED: false,
      CAPTCHA_DIFFICULTY: 'normal',
    });
    expect(envSchema.parse({ ...base, CAPTCHA_HMAC_KEY: KEY })).toMatchObject({
      CAPTCHA_ENABLED: true,
      CAPTCHA_HMAC_KEY: KEY,
    });
  });

  it.each([
    ['una clave de 31 caracteres', { CAPTCHA_HMAC_KEY: 'c'.repeat(31) }, 'CAPTCHA_HMAC_KEY'],
    ['la clave interna como clave', { CAPTCHA_HMAC_KEY: 'k'.repeat(32) }, 'CAPTCHA_HMAC_KEY'],
    ['CAPTCHA_ENABLED=yes', { CAPTCHA_ENABLED: 'yes', CAPTCHA_HMAC_KEY: KEY }, 'CAPTCHA_ENABLED'],
    [
      'CAPTCHA_DIFFICULTY=easy',
      { CAPTCHA_DIFFICULTY: 'easy', CAPTCHA_HMAC_KEY: KEY },
      'CAPTCHA_DIFFICULTY',
    ],
    [
      'una clave corta con la comprobación desactivada',
      { CAPTCHA_ENABLED: 'false', CAPTCHA_HMAC_KEY: 'x' },
      'CAPTCHA_HMAC_KEY',
    ],
  ])('CA3: con %s no arranca y no enseña el valor', (_name, overrides, variable) => {
    const found = problems({ ...base, ...overrides });
    expect(found.join('\n')).toContain(variable);
    for (const value of Object.values(overrides)) {
      if (value.length > 5) expect(found.join('\n')).not.toContain(value);
    }
  });

  it('CA3: minimal no vale en producción; normal sí, y desactivada también', () => {
    expect(
      problems({ ...production, CAPTCHA_HMAC_KEY: KEY, CAPTCHA_DIFFICULTY: 'minimal' }).join(),
    ).toContain('CAPTCHA_DIFFICULTY');
    expect(problems({ ...production, CAPTCHA_HMAC_KEY: KEY })).toEqual([]);
    expect(problems({ ...production, CAPTCHA_ENABLED: 'false' })).toEqual([]);
  });

  it('en desarrollo arranca sin clave (CaptchaService usa una aleatoria y lo avisa)', () => {
    const development = { ...base, NODE_ENV: 'development', SMTP_URL: 'smtp://127.0.0.1:1025' };
    for (const key of [undefined, '']) {
      expect(problems({ ...development, CAPTCHA_HMAC_KEY: key })).toEqual([]);
    }
    expect(problems({ ...development, CAPTCHA_HMAC_KEY: 'corta' }).join()).toContain(
      'CAPTCHA_HMAC_KEY',
    );
  });
});
