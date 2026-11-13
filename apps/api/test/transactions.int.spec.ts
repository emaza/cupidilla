import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool, QUERY_TIMEOUT_MARGIN_MS } from '../src/database/database.module.js';
import * as schema from '../src/database/schema/index.js';
import { users } from '../src/database/schema/index.js';
import { Transactions } from '../src/database/transactions.js';
import { startTcpRelay, type TcpRelay } from './helpers/tcp-relay.js';
import { truncateAll } from './helpers/test-app.js';

const STATEMENT_TIMEOUT_MS = 200;
const QUERY_TIMEOUT_MS = STATEMENT_TIMEOUT_MS + QUERY_TIMEOUT_MARGIN_MS;

const settings = (url: string) => ({
  DATABASE_URL: url,
  DB_CONNECTION_TIMEOUT_MS: 1000,
  DB_STATEMENT_TIMEOUT_MS: STATEMENT_TIMEOUT_MS,
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: 10_000,
});

const newUser = (email: string) => ({
  email,
  passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$prueba',
  birthDate: '1990-05-05',
});

describe('Transactions.run (§7.2)', () => {
  let relay: TcpRelay;
  let pool: pg.Pool;
  let direct: pg.Pool;
  let transactions: Transactions;
  const directDb = () => drizzle(direct, { schema });

  beforeAll(async () => {
    relay = await startTcpRelay(process.env.DATABASE_URL ?? '');
    pool = createPool(settings(relay.url));
    direct = createPool(settings(process.env.DATABASE_URL ?? ''));
    transactions = new Transactions(pool);
  });
  afterAll(async () => {
    await pool.end();
    await direct.end();
    await relay.close();
  });
  beforeEach(async () => {
    await truncateAll(directDb());
  });

  it('un BEGIN que no recibe respuesta falla en el plazo de query_timeout', async () => {
    relay.arm('begin', 'drop');
    const started = performance.now();
    await expect(transactions.run(() => Promise.resolve('nunca'))).rejects.toThrow(
      'Query read timeout',
    );
    expect(relay.fired).toBe(true);
    expect(performance.now() - started).toBeLessThan(QUERY_TIMEOUT_MS + 1000);
  });

  it('tras más BEGIN colgados que el máximo del pool, el pool no se agota', async () => {
    const max = pool.options.max ?? 10;
    for (let attempt = 0; attempt < max + 2; attempt += 1) {
      relay.arm('begin', 'drop');
      await expect(transactions.run(() => Promise.resolve())).rejects.toThrow();
    }
    // Los clientes mudos se han descartado: ninguno quedó prestado ni vuelve al pool.
    expect(pool.totalCount - pool.idleCount).toBe(0);
    const { rows } = await pool.query<{ ok: number }>('select 1 as ok');
    expect(rows[0]?.ok).toBe(1);
    expect(
      await transactions.run(async (tx) => (await tx.execute(sql`select 2 as n`)).rows),
    ).toEqual([{ n: 2 }]);
  });

  it('un COMMIT cuya respuesta se pierde descarta el cliente y deja salir el error original', async () => {
    relay.arm('commit', 'after');
    await expect(
      transactions.run((tx) => tx.insert(users).values(newUser('confirmada@example.com'))),
    ).rejects.toThrow('Query read timeout');
    expect(pool.totalCount - pool.idleCount).toBe(0);
    // El servidor sí recibió el COMMIT: la fila existe. De ahí el «resultado incierto».
    expect(await directDb().select().from(users)).toHaveLength(1);
  });

  it('un error normal hace ROLLBACK, no deja nada y el cliente vuelve al pool', async () => {
    const before = pool.totalCount;
    const failure = new Error('fallo de la lógica');
    await expect(
      transactions.run(async (tx) => {
        await tx.insert(users).values(newUser('rollback@example.com'));
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await directDb().select().from(users)).toHaveLength(0);
    // El cliente no se ha descartado: sigue en el pool, libre.
    expect(pool.totalCount).toBeGreaterThanOrEqual(Math.max(before, 1));
    expect(pool.idleCount).toBe(pool.totalCount);
  });

  it('una violación de unicidad dentro de la transacción deshace también lo anterior', async () => {
    await directDb().insert(users).values(newUser('repetido@example.com'));
    await expect(
      transactions.run(async (tx) => {
        await tx.insert(users).values(newUser('nuevo@example.com'));
        await tx.insert(users).values(newUser('repetido@example.com'));
      }),
    ).rejects.toThrow();
    const emails = (await directDb().select({ email: users.email }).from(users)).map(
      (row) => row.email,
    );
    expect(emails).toEqual(['repetido@example.com']);
  });
});
