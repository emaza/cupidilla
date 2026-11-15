import { describe, expect, it } from 'vitest';
import { envSchema } from './env.schema.js';

/** Configuración del correo (diseño técnico de correo §8.1, tarea A.1). */
const base = {
  DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/cupidilla',
  INTERNAL_API_KEY: 'k'.repeat(32),
  PUBLIC_WEB_URL: 'http://localhost:5173',
};
const production = {
  ...base,
  NODE_ENV: 'production',
  PUBLIC_WEB_URL: 'https://cupidilla.es',
  SMTP_URL: 'smtps://usuario:clave@smtp.proveedor.eu',
};

function parse(env: Record<string, string | undefined>) {
  return envSchema.safeParse(env);
}

/** Mensajes con la variable delante («VARIABLE: mensaje»). */
function problems(env: Record<string, string | undefined>): string[] {
  const result = parse(env);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

const pathsOf = (env: Record<string, string | undefined>): string[] =>
  problems(env).map((problem) => problem.slice(0, problem.indexOf(':')));

describe('A.1: configuración del correo (§8.1)', () => {
  it('A1-1: con NODE_ENV=development y sin SMTP_URL no arranca; el error nombra SMTP_URL sin valores', () => {
    const messages = problems({ ...base, NODE_ENV: 'development' });
    expect(messages).toEqual([expect.stringMatching(/^SMTP_URL: .*SMTP_URL/)]);
    for (const value of ['postgres://', 'localhost:5173', 'k'.repeat(32)]) {
      expect(messages.join(' ')).not.toContain(value);
    }
    // Sin NODE_ENV vale development: tampoco arranca.
    expect(pathsOf(base)).toEqual(['SMTP_URL']);
  });

  it('con NODE_ENV=test arranca sin SMTP_URL, con los valores por defecto del correo', () => {
    const result = parse({ ...base, NODE_ENV: 'test' });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      MAIL_FROM: 'Cupidilla <no-reply@example.com>',
      MAIL_SUPPORT_ADDRESS: 'soporte@example.com',
      EMAIL_UNVERIFIED_REMINDER: true,
      EMAIL_PASSWORD_CHANGED_NOTICE: true,
    });
    expect(result.data?.SMTP_URL).toBeUndefined();
  });

  it('A1-3: en producción, MAIL_FROM y MAIL_SUPPORT_ADDRESS de ejemplo no valen', () => {
    // MAIL_FROM sin definir vale «Cupidilla <no-reply@example.com>».
    expect(pathsOf({ ...production, MAIL_SUPPORT_ADDRESS: 'soporte@cupidilla.es' })).toEqual([
      'MAIL_FROM',
    ]);
    expect(
      pathsOf({
        ...production,
        MAIL_FROM: 'Cupidilla <no-reply@cupidilla.es>',
        MAIL_SUPPORT_ADDRESS: 'soporte@example.com',
      }),
    ).toEqual(['MAIL_SUPPORT_ADDRESS']);
    expect(
      problems({
        ...production,
        MAIL_FROM: 'Cupidilla <no-reply@cupidilla.es>',
        MAIL_SUPPORT_ADDRESS: 'soporte@cupidilla.es',
      }),
    ).toEqual([]);
    // Ningún mensaje muestra la URL del SMTP (lleva la clave).
    expect(problems(production).join(' ')).not.toMatch(/clave|proveedor\.eu/);
  });

  it('A1-4: en producción, MAIL_SUPPORT_ADDRESS en un TLD reservado (.test) no vale', () => {
    expect(
      pathsOf({
        ...production,
        MAIL_FROM: 'Cupidilla <no-reply@cupidilla.es>',
        MAIL_SUPPORT_ADDRESS: 'ayuda@cupidilla.test',
      }),
    ).toEqual(['MAIL_SUPPORT_ADDRESS']);
  });

  it.each([
    'no-reply@example.net',
    'no-reply@correo.example.org',
    'no-reply@cupidilla.example',
    'no-reply@cupidilla.invalid',
    'no-reply@cupidilla.localhost',
  ])('en producción, MAIL_FROM=%s no vale', (address) => {
    expect(
      pathsOf({ ...production, MAIL_FROM: address, MAIL_SUPPORT_ADDRESS: 'soporte@cupidilla.es' }),
    ).toEqual(['MAIL_FROM']);
  });

  it('A1-5: en producción, SMTP_URL en loopback no vale y el mensaje no la muestra', () => {
    const messages = problems({
      ...production,
      SMTP_URL: 'smtp://127.0.0.1:1025',
      MAIL_FROM: 'Cupidilla <no-reply@cupidilla.es>',
      MAIL_SUPPORT_ADDRESS: 'soporte@cupidilla.es',
    });
    expect(messages).toEqual([expect.stringMatching(/^SMTP_URL: /)]);
    expect(messages.join(' ')).not.toContain('127.0.0.1');
  });

  it.each(['http://smtp.proveedor.eu', 'no es una url'])(
    'SMTP_URL=%j no es smtp: ni smtps: y el error no muestra el valor',
    (value) => {
      const messages = problems({ ...base, SMTP_URL: value });
      expect(pathsOf({ ...base, SMTP_URL: value })).toEqual(['SMTP_URL']);
      expect(messages.join(' ')).not.toContain(value);
    },
  );

  it('A1-6: PUBLIC_WEB_URL es solo un origen https: (o http: en loopback)', () => {
    const env = { ...base, NODE_ENV: 'test' };
    expect(pathsOf({ ...env, PUBLIC_WEB_URL: 'http://cupidilla.es' })).toEqual(['PUBLIC_WEB_URL']);
    expect(problems({ ...env, PUBLIC_WEB_URL: 'http://localhost:5173' })).toEqual([]);
    expect(pathsOf({ ...env, PUBLIC_WEB_URL: 'https://cupidilla.es/' })).toEqual([
      'PUBLIC_WEB_URL',
    ]);
    expect(pathsOf({ ...env, PUBLIC_WEB_URL: undefined })).toEqual(['PUBLIC_WEB_URL']);
  });

  it('A1-7: con OAUTH_REDIRECT_BASE_URL (un .env antiguo) no arranca', () => {
    const messages = problems({
      ...base,
      NODE_ENV: 'test',
      OAUTH_REDIRECT_BASE_URL: 'http://localhost:5173',
    });
    expect(messages).toEqual([
      'OAUTH_REDIRECT_BASE_URL: OAUTH_REDIRECT_BASE_URL ya no existe: usa PUBLIC_WEB_URL',
    ]);
  });

  it('A1-8: EMAIL_UNVERIFIED_REMINDER solo admite true o false', () => {
    const env = { ...base, NODE_ENV: 'test' };
    expect(pathsOf({ ...env, EMAIL_UNVERIFIED_REMINDER: 'si' })).toEqual([
      'EMAIL_UNVERIFIED_REMINDER',
    ]);
    const parsed = parse({ ...env, EMAIL_UNVERIFIED_REMINDER: 'false' });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.EMAIL_UNVERIFIED_REMINDER).toBe(false);
    expect(pathsOf({ ...env, EMAIL_PASSWORD_CHANGED_NOTICE: '1' })).toEqual([
      'EMAIL_PASSWORD_CHANGED_NOTICE',
    ]);
    expect(parse({ ...env, EMAIL_PASSWORD_CHANGED_NOTICE: 'false' }).data).toMatchObject({
      EMAIL_PASSWORD_CHANGED_NOTICE: false,
    });
  });

  it('MAIL_FROM acepta una dirección sola o con nombre, y nada más', () => {
    const env = { ...base, NODE_ENV: 'test' };
    expect(problems({ ...env, MAIL_FROM: 'hola@cupidilla.test' })).toEqual([]);
    expect(problems({ ...env, MAIL_FROM: 'Cupidilla <hola@cupidilla.test>' })).toEqual([]);
    expect(pathsOf({ ...env, MAIL_FROM: 'Cupidilla' })).toEqual(['MAIL_FROM']);
    expect(pathsOf({ ...env, MAIL_FROM: 'Cupidilla <no es correo>' })).toEqual(['MAIL_FROM']);
  });
});
