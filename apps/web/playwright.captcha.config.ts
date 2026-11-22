import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { WEB_URL } from './tests/e2e/helpers/oauth-env.ts';
import { e2eServers } from './tests/e2e/helpers/servers.ts';

/**
 * e2e con la comprobación antibots activada y la dificultad mínima (técnico de captcha §5.4, T10).
 * Mismos servidores y puertos que la suite principal: va después, nunca a la vez.
 */
const envFile = resolve(import.meta.dirname, '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.captcha.e2e.ts',
  globalSetup: './tests/e2e/global-setup.ts',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: WEB_URL,
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', grepInvert: /@nojs/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'chromium-no-js',
      grep: /@nojs/,
      use: { ...devices['Desktop Chrome'], javaScriptEnabled: false },
    },
  ],
  webServer: e2eServers({ captcha: true }).map((server) => ({
    ...server,
    cwd: '../..',
    reuseExistingServer: process.env.E2E_REUSE === '1',
  })),
});
