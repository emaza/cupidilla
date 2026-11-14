/**
 * Proveedor OAuth falso en los e2e (técnico §14.1): tercer `webServer` de Playwright en
 * 127.0.0.1:4400. La web va en `localhost`, así que la vuelta del proveedor es una navegación
 * entre sitios distintos de verdad, como con Google y Facebook.
 */
export const WEB_URL = 'http://localhost:4173';
export const FAKE_PROVIDER_URL = 'http://127.0.0.1:4400';

/** Credenciales de prueba que comparten la API de los e2e y el proveedor falso. */
export const OAUTH_E2E_ENV = {
  // Origen de la web (correo §11.2): base de la redirect URI y de los enlaces de los correos.
  PUBLIC_WEB_URL: WEB_URL,
  GOOGLE_CLIENT_ID: 'google-cliente-e2e',
  GOOGLE_CLIENT_SECRET: 'google-secreto-e2e-0123456789',
  FACEBOOK_APP_ID: '987654321',
  FACEBOOK_APP_SECRET: 'facebook-secreto-e2e-0123456789',
  OAUTH_FAKE_PROVIDER_URL: FAKE_PROVIDER_URL,
} as const;
