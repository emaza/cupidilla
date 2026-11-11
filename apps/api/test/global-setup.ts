import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadEnv } from 'vite';

/** Antes de la integración: vacía cupidilla_test y aplica las migraciones con los mismos scripts. */
export default function setup(): void {
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
}
