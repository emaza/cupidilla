import { startFakeOAuthProvider } from '@cupidilla/fake-oauth-provider';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import pg from 'pg';
import { loadEnv } from 'vite';
import {
  FAKE_PROVIDER_PORT,
  FAKE_SLOW_RESPONSE_MS,
  PUBLIC_WEB_URL,
  OAUTH_TEST_ENV,
} from './helpers/oauth-env.js';
import { INT_MAX_WORKERS, workerDatabaseName } from './helpers/test-databases.js';

/**
 * Antes de la integración: vacía y migra cupidilla_test con los mismos scripts, la clona para cada worker y
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
  await cloneForWorkers(databaseUrl);

  const provider = await startFakeOAuthProvider({
    port: FAKE_PROVIDER_PORT,
    google: {
      clientId: OAUTH_TEST_ENV.GOOGLE_CLIENT_ID,
      clientSecret: OAUTH_TEST_ENV.GOOGLE_CLIENT_SECRET,
      redirectUris: [`${PUBLIC_WEB_URL}/auth/google/callback`],
    },
    facebook: {
      appId: OAUTH_TEST_ENV.FACEBOOK_APP_ID,
      appSecret: OAUTH_TEST_ENV.FACEBOOK_APP_SECRET,
      redirectUris: [`${PUBLIC_WEB_URL}/auth/facebook/callback`],
    },
    slowResponseMs: FAKE_SLOW_RESPONSE_MS,
  });
  return () => provider.close();
}

/** Clona la base migrada en una por worker (`CREATE DATABASE … TEMPLATE`, mucho más rápido que migrar). */
async function cloneForWorkers(databaseUrl: string): Promise<void> {
  const admin = new URL(databaseUrl);
  const baseName = admin.pathname.slice(1);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    for (let id = 1; id <= INT_MAX_WORKERS; id += 1) {
      const name = `"${workerDatabaseName(baseName, id)}"`;
      await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await client.query(`CREATE DATABASE ${name} TEMPLATE "${baseName}"`);
    }
  } finally {
    await client.end();
  }
}
