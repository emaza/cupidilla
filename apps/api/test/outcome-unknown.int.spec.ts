import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../src/database/schema/index.js';
import { startTcpRelay, type TcpRelay } from './helpers/tcp-relay.js';

/**
 * OUTCOME_UNKNOWN en la API (§6.3 y §7.2): si se pierde la respuesta de PostgreSQL a una
 * escritura ya enviada, la API no sabe si se hizo y responde 503 OUTCOME_UNKNOWN, no 500.
 *
 * La app de este archivo habla con PostgreSQL a través de un relé que puede dejar muda una
 * conexión justo después de reenviar una sentencia. `envSchema` se valida al importar
 * `AppModule`, así que el entorno se fija antes de importar los helpers de la app.
 */
const databaseUrl = process.env.DATABASE_URL ?? '';
const relay: TcpRelay = await startTcpRelay(databaseUrl);
const previous = {
  DATABASE_URL: process.env.DATABASE_URL,
  DB_STATEMENT_TIMEOUT_MS: process.env.DB_STATEMENT_TIMEOUT_MS,
};
process.env.DATABASE_URL = relay.url;
process.env.DB_STATEMENT_TIMEOUT_MS = '300'; // query_timeout = 800 ms
const { api, createTestApp, registerBody, registerUser, truncateAll } =
  await import('./helpers/test-app.js');

describe('OUTCOME_UNKNOWN cuando se pierde la respuesta de la base de datos', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  // Comprobaciones directas, sin pasar por el relé.
  const direct = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const directDb = drizzle(direct, { schema });
  const usersWithEmail = async (email: string) =>
    (await direct.query('select 1 from users where email = $1', [email])).rowCount;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
    await direct.end();
    await relay.close();
    Object.assign(process.env, previous);
  });
  beforeEach(async () => {
    await truncateAll(directDb);
  });

  it('se pierde la respuesta del COMMIT del registro → 503 OUTCOME_UNKNOWN (y la cuenta existe)', async () => {
    const body = registerBody();
    relay.arm('commit', 'after');
    const response = await api(t.app).post('/auth/register').send(body);
    expect(relay.fired).toBe(true);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: { code: 'OUTCOME_UNKNOWN', message: 'Outcome unknown' },
    });
    expect(await usersWithEmail(body.email)).toBe(1);
  });

  it('se pierde la respuesta del DELETE del borrado → 503 OUTCOME_UNKNOWN (y la cuenta ya no está)', async () => {
    const user = await registerUser(t.app);
    relay.arm('delete from "users"', 'after');
    const response = await api(t.app)
      .post('/users/me/deletion')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ password: user.password });
    expect(relay.fired).toBe(true);
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('OUTCOME_UNKNOWN');
    expect(await usersWithEmail(user.email)).toBe(0);
  });

  it('después, la API sigue funcionando: los clientes mudos se descartaron', async () => {
    relay.arm('commit', 'after');
    await api(t.app).post('/auth/register').send(registerBody());
    const body = registerBody();
    expect((await api(t.app).post('/auth/register').send(body)).status).toBe(201);
    expect(await usersWithEmail(body.email)).toBe(1);
  });

  it('un statement_timeout (57014) no es incierto: el servidor deshace, 500 INTERNAL_ERROR', async () => {
    // Otra conexión bloquea la tabla: el INSERT espera hasta que el servidor lo cancela.
    const locker = await direct.connect();
    try {
      await locker.query('begin');
      await locker.query('lock table users in access exclusive mode');
      const body = registerBody();
      const response = await api(t.app).post('/auth/register').send(body);
      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
      await locker.query('rollback');
      expect(await usersWithEmail(body.email)).toBe(0);
    } finally {
      locker.release();
    }
  });
});
