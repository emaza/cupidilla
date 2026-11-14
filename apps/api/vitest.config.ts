import { resolve } from 'node:path';
import { loadEnv } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';
import { OAUTH_TEST_ENV, PUBLIC_WEB_URL } from './test/helpers/oauth-env.js';
import { INT_MAX_WORKERS } from './test/helpers/test-databases.js';

const SERIAL_FILES = ['test/register-timing.int.spec.ts'];
const repoRoot = resolve(import.meta.dirname, '../..');
const rootEnv = loadEnv('test', repoRoot, '');
const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? rootEnv.TEST_DATABASE_URL ?? '';

const integrationOptions = {
  setupFiles: ['test/setup-worker-db.ts'],
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
};

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
          ...integrationOptions,
          name: 'integration',
          include: ['test/**/*.int.spec.ts'],
          // Corre aparte, sin carga paralela (ver integration-serial).
          exclude: [...configDefaults.exclude, ...SERIAL_FILES],
          // Crea las bases de los workers; solo aquí, para que no se ejecute dos veces.
          globalSetup: ['test/global-setup.ts'],
          // Una base por worker (global-setup las crea; setup-worker-db elige la suya).
          maxWorkers: INT_MAX_WORKERS,
          // Vitest exige un groupOrder distinto cuando los proyectos tienen distinto maxWorkers.
          sequence: { groupOrder: 1 },
        },
      },
      {
        // Tests de tiempos: corren cuando ya terminó la carga paralela. Usan la base del worker 1
        // creada por el globalSetup del proyecto integration (hay que lanzarlos junto con él).
        test: {
          ...integrationOptions,
          name: 'integration-serial',
          include: SERIAL_FILES,
          maxWorkers: 1,
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
});
