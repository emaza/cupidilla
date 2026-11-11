import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { resolve } from 'node:path';

/**
 * Pila propia de un test: una API y una web que el test arranca y para a su gusto, sobre la base
 * de datos `*_e2e`. Sirve para lo que no se puede hacer con los servidores compartidos de
 * Playwright: parar la API a mitad de un flujo y probar el límite de intentos real
 * (los compartidos llevan `RATE_LIMIT_FACTOR=100`).
 *
 * Usa lo que ya compilaron los servidores de Playwright: `apps/api/dist` y `apps/web/build`.
 */
const ROOT = resolve(import.meta.dirname, '../../../../..');

export function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolvePort(port));
    });
  });
}

async function waitFor(url: string, what: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Todavía no escucha.
    }
    if (Date.now() > deadline) throw new Error(`${what} no arrancó a tiempo (${url})`);
    await new Promise((done) => setTimeout(done, 150));
  }
}

function stop(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((done) => {
    child.once('exit', () => done());
    child.kill('SIGTERM');
  });
}

export interface Stack {
  /** URL de la web (`localhost`, para que Chromium acepte la cookie `Secure`). */
  webUrl: string;
  apiUrl: string;
  /** Para la API; la web sigue en pie y notará que no responde. */
  stopApi(): Promise<void>;
  /** Vuelve a arrancar la API en el mismo puerto (con el límite en memoria a cero). */
  startApi(): Promise<void>;
  stopAll(): Promise<void>;
}

export interface StackOptions {
  /** Arranca la API al empezar. Con `false`, la web apunta a un puerto donde no escucha nadie. */
  apiUp?: boolean;
  /** Multiplicador de los límites de intentos de la API. Con 1 son los límites reales. */
  rateLimitFactor?: number;
}

export async function startStack(options: StackOptions = {}): Promise<Stack> {
  const { apiUp = true, rateLimitFactor = 1 } = options;
  const databaseUrl = process.env.E2E_DATABASE_URL;
  if (!databaseUrl?.endsWith('_e2e')) {
    throw new Error('E2E_DATABASE_URL debe apuntar a una base de datos *_e2e');
  }
  const [apiPort, webPort] = [await freePort(), await freePort()];
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://localhost:${webPort}`;

  let api: ChildProcess | null = null;
  let web: ChildProcess | null = null;

  const startApi = async (): Promise<void> => {
    api = spawn(process.execPath, ['dist/main.js'], {
      cwd: resolve(ROOT, 'apps/api'),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DATABASE_URL: databaseUrl,
        API_HOST: '127.0.0.1',
        API_PORT: String(apiPort),
        RATE_LIMIT_FACTOR: String(rateLimitFactor),
        LOG_FORMAT: 'json',
      },
      stdio: 'ignore',
    });
    await waitFor(`${apiUrl}/health`, 'La API de la pila');
  };

  const stopAll = async (): Promise<void> => {
    await stop(web);
    await stop(api);
  };

  try {
    if (apiUp) await startApi();
    web = spawn(process.execPath, ['build/index.js'], {
      cwd: resolve(ROOT, 'apps/web'),
      env: {
        ...process.env,
        PORT: String(webPort),
        HOST: '127.0.0.1',
        ORIGIN: webUrl,
        API_URL: apiUrl,
      },
      stdio: 'ignore',
    });
    await waitFor(webUrl, 'La web de la pila');
  } catch (error) {
    await stopAll();
    throw error;
  }

  return {
    webUrl,
    apiUrl,
    stopApi: () => stop(api),
    startApi,
    stopAll,
  };
}
