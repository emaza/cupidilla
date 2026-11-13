import { describe, expect, it } from 'vitest';
import { providerSettings } from '../oauth/providers/provider-config.js';
import { envSchema } from './env.schema.js';

const base = {
  DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/cupidilla_test',
  INTERNAL_API_KEY: 'k'.repeat(32),
};
const google = { GOOGLE_CLIENT_ID: 'id-de-google', GOOGLE_CLIENT_SECRET: 'secreto-google-xyz' };
const facebook = { FACEBOOK_APP_ID: '123456', FACEBOOK_APP_SECRET: 'secreto-facebook-xyz' };
const redirect = { OAUTH_REDIRECT_BASE_URL: 'http://localhost:5173' };

/** Mensajes de error; nunca deben contener los valores de las variables. */
function problems(env: Record<string, string>): string[] {
  const result = envSchema.safeParse({ ...base, ...env });
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

describe('O-21: configuración de los proveedores (§10.4)', () => {
  it('sin proveedores, la API arranca y no hay ninguno configurado', () => {
    const env = envSchema.parse(base);
    expect(env.OAUTH_HTTP_TIMEOUT_MS).toBe(3000);
    expect(providerSettings(env)).toEqual({});
  });

  it('las variables vacías del .env cuentan como ausentes', () => {
    const env = envSchema.parse({
      ...base,
      OAUTH_REDIRECT_BASE_URL: '',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      FACEBOOK_APP_ID: '',
      FACEBOOK_APP_SECRET: '',
    });
    expect(providerSettings(env)).toEqual({});
  });

  it('con Google completo: solo Google, con los endpoints reales y la redirect URI exacta', () => {
    const settings = providerSettings(envSchema.parse({ ...base, ...google, ...redirect }));
    expect(Object.keys(settings)).toEqual(['google']);
    expect(settings.google).toMatchObject({
      redirectUri: 'http://localhost:5173/auth/google/callback',
      issuer: 'https://accounts.google.com',
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      allowInsecureRequests: false,
    });
  });

  it('con el proveedor falso, los dos apuntan a él y se permiten peticiones http', () => {
    const settings = providerSettings(
      envSchema.parse({
        ...base,
        ...google,
        ...facebook,
        ...redirect,
        OAUTH_FAKE_PROVIDER_URL: 'http://127.0.0.1:4401',
      }),
    );
    expect(settings.google?.authorizationEndpoint).toBe('http://127.0.0.1:4401/google/authorize');
    expect(settings.facebook?.tokenEndpoint).toBe(
      'http://127.0.0.1:4401/facebook/oauth/access_token',
    );
    expect(settings.google?.allowInsecureRequests).toBe(true);
  });

  it.each([
    [
      'media pareja de Google',
      { GOOGLE_CLIENT_ID: 'id-de-google', ...redirect },
      'GOOGLE_CLIENT_SECRET',
    ],
    [
      'media pareja de Facebook',
      { FACEBOOK_APP_SECRET: 'secreto-facebook-xyz', ...redirect },
      'FACEBOOK_APP_ID',
    ],
    ['proveedor sin OAUTH_REDIRECT_BASE_URL', { ...google }, 'OAUTH_REDIRECT_BASE_URL'],
    [
      'base http fuera de loopback',
      { ...google, OAUTH_REDIRECT_BASE_URL: 'http://cupidilla.example' },
      'OAUTH_REDIRECT_BASE_URL',
    ],
    [
      'base con barra final',
      { ...google, OAUTH_REDIRECT_BASE_URL: 'https://cupidilla.example/' },
      'OAUTH_REDIRECT_BASE_URL',
    ],
    [
      'base con ruta',
      { ...google, OAUTH_REDIRECT_BASE_URL: 'https://cupidilla.example/app' },
      'OAUTH_REDIRECT_BASE_URL',
    ],
    [
      'FACEBOOK_APP_ID no numérico',
      { ...redirect, FACEBOOK_APP_ID: 'abc', FACEBOOK_APP_SECRET: 'secreto-facebook-xyz' },
      'FACEBOOK_APP_ID',
    ],
    [
      'proveedor falso en producción',
      {
        ...google,
        ...redirect,
        NODE_ENV: 'production',
        OAUTH_FAKE_PROVIDER_URL: 'http://127.0.0.1:4400',
      },
      'OAUTH_FAKE_PROVIDER_URL',
    ],
    [
      'proveedor falso fuera de loopback',
      { OAUTH_FAKE_PROVIDER_URL: 'http://falso.example:4400' },
      'OAUTH_FAKE_PROVIDER_URL',
    ],
    ['timeout por encima de 4 s', { OAUTH_HTTP_TIMEOUT_MS: '4001' }, 'OAUTH_HTTP_TIMEOUT_MS'],
  ])(
    'la API no arranca con %s; el error nombra la variable y no su valor',
    (_case, env, variable) => {
      const messages = problems(env as Record<string, string>);
      expect(messages.some((message) => message.startsWith(`${variable}:`))).toBe(true);
      const joined = messages.join(' ');
      for (const secret of [
        'secreto-google-xyz',
        'secreto-facebook-xyz',
        'id-de-google',
        'cupidilla.example',
        'falso.example',
      ]) {
        expect(joined).not.toContain(secret);
      }
    },
  );

  it('acepta https en cualquier host y http en localhost, 127.0.0.1 y [::1]', () => {
    for (const url of [
      'https://cupidilla.example',
      'http://localhost:5173',
      'http://127.0.0.1:4173',
      'http://[::1]:5173',
    ]) {
      expect(problems({ ...google, OAUTH_REDIRECT_BASE_URL: url })).toEqual([]);
    }
  });
});
