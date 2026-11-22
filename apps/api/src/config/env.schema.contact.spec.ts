import { describe, expect, it } from 'vitest';
import { envSchema } from './env.schema.js';

/** Configuración del formulario de contacto (técnico de contacto §7.1, tarea T3). */
const base = {
  DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/cupidilla',
  INTERNAL_API_KEY: 'k'.repeat(32),
  // La comprobación antibots tiene su propio archivo (env.schema.captcha.spec.ts).
  CAPTCHA_ENABLED: 'false',
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
};

function problems(env: Record<string, string | undefined>): string[] {
  const result = envSchema.safeParse(env);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

describe('T3: CONTACT_TO_ADDRESS y CONTACT_ACK_EMAIL', () => {
  it('valores por defecto: buzón de ejemplo y acuse desactivado', () => {
    const result = envSchema.safeParse(base);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      CONTACT_TO_ADDRESS: 'contacto@example.com',
      CONTACT_ACK_EMAIL: false,
    });
    expect(
      envSchema.parse({ ...base, CONTACT_TO_ADDRESS: '', CONTACT_ACK_EMAIL: '' }),
    ).toMatchObject({ CONTACT_TO_ADDRESS: 'contacto@example.com', CONTACT_ACK_EMAIL: false });
  });

  it('normaliza el buzón: « Contacto@Cupidilla.ES » se queda en contacto@cupidilla.es', () => {
    expect(
      envSchema.parse({ ...base, CONTACT_TO_ADDRESS: ' Contacto@Cupidilla.ES ' })
        .CONTACT_TO_ADDRESS,
    ).toBe('contacto@cupidilla.es');
  });

  it('C17: en producción, sin la variable o con un dominio de ejemplo no arranca, sin enseñar el valor', () => {
    for (const value of [undefined, 'contacto@example.com', 'buzon@cupidilla.test']) {
      const messages = problems({ ...production, CONTACT_TO_ADDRESS: value });
      expect(messages).toEqual([
        expect.stringMatching(/^CONTACT_TO_ADDRESS: .*CONTACT_TO_ADDRESS/),
      ]);
      if (value) expect(messages.join(' ')).not.toContain(value);
    }
    expect(problems({ ...production, CONTACT_TO_ADDRESS: 'contacto@cupidilla.es' })).toEqual([]);
  });

  it('la misma dirección que MAIL_FROM no arranca, en cualquier entorno', () => {
    for (const env of [base, production]) {
      expect(
        problems({
          ...env,
          MAIL_FROM: 'Cupidilla <No-Reply@Cupidilla.es>',
          CONTACT_TO_ADDRESS: 'no-reply@cupidilla.es',
        }),
      ).toEqual([expect.stringMatching(/^CONTACT_TO_ADDRESS: .*MAIL_FROM/)]);
    }
  });

  it('una dirección no válida no arranca y el error nombra la variable', () => {
    expect(problems({ ...base, CONTACT_TO_ADDRESS: 'no-es-correo' })).toEqual([
      'CONTACT_TO_ADDRESS: CONTACT_TO_ADDRESS tiene que ser una dirección de correo.',
    ]);
  });

  it('CONTACT_ACK_EMAIL solo admite true o false', () => {
    expect(envSchema.parse({ ...base, CONTACT_ACK_EMAIL: 'true' }).CONTACT_ACK_EMAIL).toBe(true);
    expect(problems({ ...base, CONTACT_ACK_EMAIL: 'yes' })).toEqual([
      'CONTACT_ACK_EMAIL: CONTACT_ACK_EMAIL solo admite true o false.',
    ]);
  });
});
