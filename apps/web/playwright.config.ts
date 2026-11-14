import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { WEB_URL } from './tests/e2e/helpers/oauth-env.ts';
import { e2eServers } from './tests/e2e/helpers/servers.ts';

// Un único .env en la raíz (§11.2). Los valores ya definidos en el entorno tienen prioridad.
const envFile = resolve(import.meta.dirname, '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.e2e.ts',
  // Sin Mailpit no arranca (correo §11.2): «levanta Mailpit: npm run mail:up».
  globalSetup: './tests/e2e/global-setup.ts',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    // localhost y no 127.0.0.1: Chromium acepta cookies Secure en http://localhost (§8.3).
    baseURL: WEB_URL,
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Sin JavaScript solo corren las pruebas etiquetadas `@nojs` (formularios y flujos cuyo
    // resultado puede cambiar sin JS). `chromium` corre todo.
    {
      name: 'chromium-no-js',
      grep: /@nojs/,
      use: { ...devices['Desktop Chrome'], javaScriptEnabled: false },
    },
  ],
  webServer: e2eServers().map((server) => ({
    ...server,
    cwd: '../..',
    // Solo con E2E_REUSE=1 (README): nunca por defecto, para no probar código antiguo.
    reuseExistingServer: process.env.E2E_REUSE === '1',
  })),
});
