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

const redirectBase = env('OAUTH_REDIRECT_BASE_URL');
// En `npm run oauth:fake`, el puerto y el host salen de OAUTH_FAKE_PROVIDER_URL del .env.
const fakeUrl = process.env.OAUTH_FAKE_PROVIDER_URL;
const fromUrl = fakeUrl && URL.canParse(fakeUrl) ? new URL(fakeUrl) : undefined;
const provider = await startFakeOAuthProvider({
  port: Number(env('FAKE_OAUTH_PORT', fromUrl?.port || '4400')),
  host: env('FAKE_OAUTH_HOST', fromUrl?.hostname || '127.0.0.1'),
  google: {
    clientId: env('GOOGLE_CLIENT_ID'),
    clientSecret: env('GOOGLE_CLIENT_SECRET'),
    redirectUris: [`${redirectBase}/auth/google/callback`],
  },
  facebook: {
    appId: env('FACEBOOK_APP_ID'),
    appSecret: env('FACEBOOK_APP_SECRET'),
    redirectUris: [`${redirectBase}/auth/facebook/callback`],
  },
});

console.log(`Proveedor OAuth falso en ${provider.url}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void provider.close().then(() => process.exit(0));
  });
}
