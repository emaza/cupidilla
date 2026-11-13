import {
  createConnection,
  createServer,
  type AddressInfo,
  type Server,
  type Socket,
} from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../src/database/database.module.js';

/**
 * QA, tercera revisión. `statement_timeout` e `idle_in_transaction_session_timeout` los aplica el
 * SERVIDOR: si la red se corta sin cerrar la conexión (cortafuegos que descarta paquetes, NAT que
 * caduca, PostgreSQL congelado), el servidor no puede avisar de nada. `connectionTimeoutMillis`
 * solo cubre conseguir una conexión nueva. Una consulta sobre una conexión ya abierta puede
 * esperar sin límite. El diseño (§7.2) dice «ninguna espera es infinita».
 */
describe('[BUG-QA-8] consulta sobre una conexión ya abierta cuando la red deja de responder', () => {
  let relay: Server;
  const sockets = new Set<Socket>();
  let frozen = false;
  let url = '';

  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL ?? '');
    // Reenvía a PostgreSQL y, al congelarlo, deja de pasar bytes en los dos sentidos sin cerrar.
    relay = createServer((client) => {
      const upstream = createConnection({ host: target.hostname, port: Number(target.port) });
      sockets.add(client).add(upstream);
      client.on('data', (chunk) => !frozen && upstream.write(chunk));
      upstream.on('data', (chunk) => !frozen && client.write(chunk));
      for (const socket of [client, upstream]) socket.on('error', () => undefined);
      client.on('close', () => upstream.destroy());
      upstream.on('close', () => client.destroy());
    });
    await new Promise<void>((done) => relay.listen(0, '127.0.0.1', done));
    const { port } = relay.address() as AddressInfo;
    const through = new URL(target);
    through.hostname = '127.0.0.1';
    through.port = String(port);
    url = through.toString();
  });
  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((done) => relay.close(done));
  });

  it('la consulta falla en pocos segundos, no espera sin límite', async () => {
    const pool = createPool({
      DATABASE_URL: url,
      DB_CONNECTION_TIMEOUT_MS: 500,
      DB_STATEMENT_TIMEOUT_MS: 1000,
      DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: 10_000,
    });
    try {
      await pool.query('select 1'); // deja una conexión abierta y libre en el pool
      frozen = true;
      const started = performance.now();
      const outcome = await Promise.race([
        pool.query('select 1').then(
          () => 'respondió',
          () => 'falló',
        ),
        new Promise<string>((done) => setTimeout(() => done('sigue esperando a los 6 s'), 6000)),
      ]);
      const seconds = Math.round((performance.now() - started) / 100) / 10;
      expect(outcome, `tras ${seconds} s`).toBe('falló');
    } finally {
      frozen = false;
      for (const socket of sockets) socket.destroy();
      pool.on('error', () => undefined);
      await pool.end().catch(() => undefined);
    }
  }, 20_000);
});
