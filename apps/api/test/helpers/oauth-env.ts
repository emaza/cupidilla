/**
 * Credenciales y direcciones del proveedor falso en la integración (§14.1). Las comparten
 * `vitest.config.ts` (entorno de la API), `global-setup.ts` (arranca el falso) y los tests.
 */
export const FAKE_PROVIDER_PORT = 4401;
export const FAKE_PROVIDER_URL = `http://127.0.0.1:${FAKE_PROVIDER_PORT}`;
export const OAUTH_REDIRECT_BASE_URL = 'http://localhost:5173';
/** Timeout por petición al proveedor en los tests; `slow_token` tarda más. */
export const OAUTH_HTTP_TIMEOUT_MS = 1000;
export const FAKE_SLOW_RESPONSE_MS = 1500;

export const OAUTH_TEST_ENV = {
  OAUTH_REDIRECT_BASE_URL,
  GOOGLE_CLIENT_ID: 'google-cliente-de-prueba',
  GOOGLE_CLIENT_SECRET: 'google-secreto-de-prueba-0123456789',
  FACEBOOK_APP_ID: '1234567890',
  FACEBOOK_APP_SECRET: 'facebook-secreto-de-prueba-0123456789',
  OAUTH_HTTP_TIMEOUT_MS: String(OAUTH_HTTP_TIMEOUT_MS),
  OAUTH_FAKE_PROVIDER_URL: FAKE_PROVIDER_URL,
} as const;
