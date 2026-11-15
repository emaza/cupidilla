/**
 * CLI del proveedor falso para Playwright y para `npm run dev` con el proveedor falso
 * (`npm run oauth:fake`, que lee el .env de la raíz). Lee del entorno el puerto, la base de la
 * redirect URI y las credenciales que usa la API.
 */
import { startFakeOAuthProvider } from './index.ts';

const env = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    console.error(`Falta la variable ${name}.`);
    process.exit(1);
  }
  return value;
};

const redirectBase = env('PUBLIC_WEB_URL');
// En `npm run oauth:fake`, el puerto y el host salen de OAUTH_FAKE_PROVIDER_URL del .env.
const fakeUrl = process.env.OAUTH_FAKE_PROVIDER_URL;
const fromUrl = fakeUrl && URL.canParse(fakeUrl) ? new URL(fakeUrl) : undefined;
/**
 * Credenciales de un proveedor, o unas ficticias si no está configurado: la API no lo usará
 * (solo activa un proveedor con su pareja completa), y así basta con configurar uno.
 */
const credentials = (idName: string, secretName: string, fallbackId: string) => {
  const id = process.env[idName];
  const secret = process.env[secretName];
  return id && secret ? { id, secret } : { id: fallbackId, secret: `no-configurado-${fallbackId}` };
};
const google = credentials('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'google-no-configurado');
const facebook = credentials('FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', '0');

const provider = await startFakeOAuthProvider({
  port: Number(env('FAKE_OAUTH_PORT', fromUrl?.port || '4400')),
  host: env('FAKE_OAUTH_HOST', fromUrl?.hostname || '127.0.0.1'),
  google: {
    clientId: google.id,
    clientSecret: google.secret,
    redirectUris: [`${redirectBase}/auth/google/callback`],
  },
  facebook: {
    appId: facebook.id,
    appSecret: facebook.secret,
    redirectUris: [`${redirectBase}/auth/facebook/callback`],
  },
});

console.log(`Proveedor OAuth falso en ${provider.url}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void provider.close().then(() => process.exit(0));
  });
}
