import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, type PoolSettings } from '../src/database/database.module.js';
import { DB } from '../src/database/database.types.js';
import * as schema from '../src/database/schema/index.js';
import { HealthController } from '../src/health/health.controller.js';

const settings = (overrides: Partial<PoolSettings> = {}): PoolSettings => ({
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  DB_CONNECTION_TIMEOUT_MS: 3000,
  DB_STATEMENT_TIMEOUT_MS: 4000,
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: 10_000,
  ...overrides,
});

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe('Límites de tiempo de PostgreSQL (§7.2)', () => {
  it('una consulta más larga que statement_timeout se cancela (57014)', async () => {
    const pool = createPool(settings({ DB_STATEMENT_TIMEOUT_MS: 200 }));
    try {
      await expect(pool.query('select pg_sleep(2)')).rejects.toMatchObject({
        code: '57014', // query_canceled
      });
      // El pool sigue sirviendo después de la cancelación.
      const { rows } = await pool.query<{ ok: number }>('select 1 as ok');
      expect(rows[0]?.ok).toBe(1);
    } finally {
      await pool.end();
    }
  });

  it('una transacción inactiva más de lo permitido se aborta: el servidor cierra la sesión', async () => {
    const pool = createPool(settings({ DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: 200 }));
    const client = await pool.connect();
    // El servidor cierra la sesión: pg emite `error` en el cliente y hay que escucharlo.
    client.on('error', () => undefined);
    try {
      await client.query('begin');
      await pause(600);
      await expect(client.query('select 1')).rejects.toBeDefined();
    } finally {
      client.release(true);
      await pool.end();
    }
  });
});

describe('/health sin base de datos', () => {
  let silent: Server;
  const sockets = new Set<Socket>();
  let app: NestExpressApplication;
  let pool: ReturnType<typeof createPool>;

  beforeAll(async () => {
    // Acepta conexiones y nunca responde: como un PostgreSQL colgado o tras un cortafuegos.
    silent = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((done) => silent.listen(0, '127.0.0.1', done));
    const { port } = silent.address() as AddressInfo;
    pool = createPool(
      settings({
        DATABASE_URL: `postgres://nadie:nada@127.0.0.1:${port}/cupidilla_test`,
        DB_CONNECTION_TIMEOUT_MS: 300,
      }),
    );
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DB, useValue: drizzle(pool, { schema }) }],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    // Este pool no es del DatabaseModule: Nest no lo cierra.
    await pool.end();
    for (const socket of sockets) socket.destroy();
    await new Promise((done) => silent.close(done));
  });

  it('responde 503 dentro del plazo de adquisición, sin esperar indefinidamente', async () => {
    const started = performance.now();
    const response = await request(app.getHttpServer()).get('/health');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'unavailable' });
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
