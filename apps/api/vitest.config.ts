import { resolve } from 'node:path';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { OAUTH_TEST_ENV, PUBLIC_WEB_URL } from './test/helpers/oauth-env.js';

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
            // Sin SMTP_URL: con NODE_ENV=test, MailModule usa MemoryMailer y el worker no arranca su
            // temporizador (correo §11.1). Vacías (= ausentes) para que lo exportado en el shell no
            // cambie el Mailer ni los textos: MAIL_FROM y MAIL_SUPPORT_ADDRESS valen lo de por defecto.
            SMTP_URL: '',
            MAIL_FROM: '',
            MAIL_SUPPORT_ADDRESS: '',
            EMAIL_UNVERIFIED_REMINDER: '',
            EMAIL_PASSWORD_CHANGED_NOTICE: '',
            OAUTH_REDIRECT_BASE_URL: '',
            PUBLIC_WEB_URL,
            ...OAUTH_TEST_ENV,
          },
        },
      },
    ],
  },
});
