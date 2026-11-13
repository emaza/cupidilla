import { startFakeOAuthProvider } from '@cupidilla/fake-oauth-provider';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadEnv } from 'vite';
import {
  FAKE_PROVIDER_PORT,
  FAKE_SLOW_RESPONSE_MS,
  OAUTH_REDIRECT_BASE_URL,
  OAUTH_TEST_ENV,
} from './helpers/oauth-env.js';

/**
 * Antes de la integración: vacía cupidilla_test, aplica las migraciones con los mismos scripts y
 * arranca el proveedor OAuth falso (§14.1). Devuelve la parada del proveedor.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const apiRoot = resolve(import.meta.dirname, '..');
  const rootEnv = loadEnv('test', resolve(apiRoot, '../..'), '');
  const databaseUrl = process.env.TEST_DATABASE_URL ?? rootEnv.TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Falta TEST_DATABASE_URL (en .env de la raíz o en el entorno).');
  }
  const env = { ...process.env, DATABASE_URL: databaseUrl };
  for (const script of ['scripts/reset-db.ts', 'scripts/migrate.ts']) {
    execFileSync(process.execPath, [script], { cwd: apiRoot, env, stdio: 'inherit' });
  }

  const provider = await startFakeOAuthProvider({
    port: FAKE_PROVIDER_PORT,
    google: {
      clientId: OAUTH_TEST_ENV.GOOGLE_CLIENT_ID,
      clientSecret: OAUTH_TEST_ENV.GOOGLE_CLIENT_SECRET,
      redirectUris: [`${OAUTH_REDIRECT_BASE_URL}/auth/google/callback`],
    },
    facebook: {
      appId: OAUTH_TEST_ENV.FACEBOOK_APP_ID,
      appSecret: OAUTH_TEST_ENV.FACEBOOK_APP_SECRET,
      redirectUris: [`${OAUTH_REDIRECT_BASE_URL}/auth/facebook/callback`],
    },
    slowResponseMs: FAKE_SLOW_RESPONSE_MS,
  });
  return () => provider.close();
}
