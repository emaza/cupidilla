import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { assertMailpitUp } from './helpers/mailpit.ts';
import { e2eServers } from './helpers/servers.ts';

/**
 * `npm run test:e2e:serve`: deja corriendo API, web y proveedor falso en los puertos de los e2e,
 * para lanzar `npx playwright test <archivo>` sin recompilar. Playwright los reutiliza
 * (`reuseExistingServer` fuera de CI). Tras cambiar código hay que parar este proceso y
 * volver a lanzarlo: compila al arrancar y no recarga.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const children: ChildProcess[] = [];
let stopping = false;

function stopAll(code: number): void {
  if (stopping) return;
  stopping = true;
  // Cada servidor va en su propio grupo de procesos (shell + npm + node): se para el grupo.
  for (const child of children) {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
    } catch {
      // Ya había terminado.
    }
  }
  // Si los hijos paran antes de 500 ms y el temporizador (unref) no llega a correr, el proceso
  // sale solo: que lo haga con este código y no con 0.
  process.exitCode = code;
  setTimeout(() => process.exit(code), 500).unref();
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      // Cada petición, acotada por el tiempo que queda (y como mucho 5 s).
      const remaining = Math.max(1, Math.min(deadline - Date.now(), 5000));
      if ((await fetch(url, { signal: AbortSignal.timeout(remaining) })).ok) return;
    } catch {
      // Todavía no escucha (o no ha respondido a tiempo).
    }
    if (stopping) return;
    if (Date.now() > deadline) throw new Error(`no respondió a tiempo: ${url}`);
    await new Promise((done) => setTimeout(done, 300));
  }
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

await assertMailpitUp();
const servers = e2eServers();
for (const server of servers) {
  if (stopping) break;
  if (
    await fetch(server.url, { signal: AbortSignal.timeout(3000) }).then(
      (r) => r.ok,
      () => false,
    )
  ) {
    console.error(`${server.name}: ya hay algo respondiendo en ${server.url}; páralo antes.`);
    process.exit(1);
  }
}
for (const server of stopping ? [] : servers) {
  const child = spawn(server.command, {
    cwd: ROOT,
    shell: true,
    detached: true,
    stdio: 'inherit',
    env: { ...process.env, ...server.env },
  });
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`${server.name} terminó (código ${code}); paro el resto.`);
      stopAll(1);
    }
  });
  children.push(child);
}
try {
  await Promise.all(servers.map((s) => waitFor(s.url, s.timeout)));
  if (!stopping) console.log('\nServidores de e2e listos. Ctrl+C para pararlos.');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stopAll(1);
}
