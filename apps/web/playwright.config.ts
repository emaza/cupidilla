import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Un único .env en la raíz (§11.2). Los valores ya definidos en el entorno tienen prioridad.
const envFile = resolve(import.meta.dirname, '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const API_PORT = '3101';
const WEB_URL = 'http://localhost:4173';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.e2e.ts',
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    // localhost y no 127.0.0.1: Chromium acepta cookies Secure en http://localhost (§8.3).
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-no-js', use: { ...devices['Desktop Chrome'], javaScriptEnabled: false } },
  ],
  webServer: [
    {
      command: 'npm run build -w @cupidilla/api && npm run start:e2e -w @cupidilla/api',
      cwd: '../..',
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        NODE_ENV: 'production',
        DATABASE_URL: process.env.E2E_DATABASE_URL ?? '',
        API_HOST: '127.0.0.1',
        API_PORT,
        // Todas las peticiones llegan desde la misma IP (§12.2).
        RATE_LIMIT_FACTOR: '100',
        LOG_FORMAT: 'json',
      },
    },
    {
      command: 'npm run build -w @cupidilla/web && npm run preview -w @cupidilla/web',
      cwd: '../..',
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { API_URL: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
