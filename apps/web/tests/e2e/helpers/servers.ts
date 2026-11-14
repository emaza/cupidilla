import { mailpitSmtpUrl } from './mailpit.ts';
import { FAKE_PROVIDER_URL, OAUTH_E2E_ENV, WEB_URL } from './oauth-env.ts';

/**
 * Los tres servidores de los e2e (API, web compilada y proveedor OAuth falso), con su comando y
 * su entorno. Los comparten `playwright.config.ts` (`webServer`) y `serve.ts`
 * (`npm run test:e2e:serve`), para que las variables no se dupliquen.
 *
 * Es una función y no una constante: el .env se carga después de importar el módulo.
 */
export const API_PORT = '3101';

export interface E2eServer {
  name: string;
  command: string;
  /** Relativo a la raíz del monorepo. */
  url: string;
  timeout: number;
  env: Record<string, string>;
}

export function e2eServers(): E2eServer[] {
  return [
    {
      name: 'api',
      command: 'npm run build -w @cupidilla/api && npm run start:e2e -w @cupidilla/api',
      url: `http://127.0.0.1:${API_PORT}/health`,
      timeout: 180_000,
      env: {
        // `test` y no `production`: la API se niega a usar el proveedor falso en producción
        // (técnico §10.4). En la API, NODE_ENV no cambia nada más.
        NODE_ENV: 'test',
        DATABASE_URL: process.env.E2E_DATABASE_URL ?? '',
        API_HOST: '127.0.0.1',
        API_PORT,
        // Todas las peticiones llegan desde la misma IP (§12.2).
        RATE_LIMIT_FACTOR: '100',
        LOG_FORMAT: 'json',
        // Google y Facebook apuntan al proveedor falso (técnico §14.1). Trae PUBLIC_WEB_URL.
        ...OAUTH_E2E_ENV,
        // El worker envía de verdad a Mailpit, y kick() al momento (correo §11.2).
        SMTP_URL: mailpitSmtpUrl(),
      },
    },
    {
      name: 'web',
      // Con OAUTH_FAKE_PROVIDER_URL al compilar, la CSP admite el falso en form-action (§12.4).
      command: 'npm run build -w @cupidilla/web && npm run preview -w @cupidilla/web',
      url: WEB_URL,
      timeout: 180_000,
      env: {
        API_URL: `http://127.0.0.1:${API_PORT}`,
        OAUTH_FAKE_PROVIDER_URL: FAKE_PROVIDER_URL,
      },
    },
    {
      name: 'oauth-falso',
      command: 'node packages/fake-oauth-provider/src/main.ts',
      url: `${FAKE_PROVIDER_URL}/health`,
      timeout: 30_000,
      env: { ...OAUTH_E2E_ENV, FAKE_OAUTH_PORT: '4400', FAKE_OAUTH_HOST: '127.0.0.1' },
    },
  ];
}
