import { resolve } from 'node:path';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { OAUTH_TEST_ENV } from './test/helpers/oauth-env.js';

const repoRoot = resolve(import.meta.dirname, '../..');
const rootEnv = loadEnv('test', repoRoot, '');
const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? rootEnv.TEST_DATABASE_URL ?? '';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/**/*.int.spec.ts'],
          globalSetup: ['test/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
          // Los tests no heredan el .env de desarrollo: solo lo que se fija aquí.
          env: {
            NODE_ENV: 'test',
            DATABASE_URL: testDatabaseUrl,
            TEST_DATABASE_URL: testDatabaseUrl,
            INTERNAL_API_KEY: 'test-internal-api-key-0123456789abcdef',
            LOG_FORMAT: 'json',
            SESSION_TTL_DAYS: '30',
            RATE_LIMIT_FACTOR: '1',
            ...OAUTH_TEST_ENV,
          },
        },
      },
    ],
  },
});
