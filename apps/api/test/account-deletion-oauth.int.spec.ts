import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runFlow, signupBody } from './helpers/oauth.js';
import {
  api,
  countRows,
  createTestApp,
  TEST_NOW,
  truncateAll,
  uniqueIp,
  type TestApp,
} from './helpers/test-app.js';

describe('O-17: borrar una cuenta sin contraseña (§9.2, decisión 20)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await truncateAll(t.db);
    t.clock.set(TEST_NOW);
  });

  const authed = (token: string) => ({
    post: (path: string) =>
      api(t.app, uniqueIp()).post(path).set('Authorization', `Bearer ${token}`),
  });

  async function googleAccount() {
    const flow = await runFlow(t.app);
    const created = await api(t.app)
      .post('/auth/oauth/signup')
      .send(signupBody(flow.response.body.pending.token as string));
    return { identity: flow.identity, token: created.body.session.token as string };
  }

  /** Tablas con FK a users (las mismas que recorre I-16), más oauth_states, que cuelga de sessions. */
  async function tablesReferencingUsers(): Promise<string[]> {
    const result = await t.db.execute<{ table_name: string }>(sql`
      select distinct tc.table_name
      from information_schema.table_constraints tc
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
      where tc.constraint_type = 'FOREIGN KEY' and ccu.table_name = 'users'`);
    return result.rows.map((row) => row.table_name);
  }

  it('con la sesión de hace horas → 204 sin pedir nada más, y nada queda (decisión 20)', async () => {
    const account = await googleAccount();
    // Un flujo de reautenticación a medias: cuelga de la sesión y se borra con ella.
    const started = await authed(account.token)
      .post('/users/me/oauth/google/authorization')
      .send({ purpose: 'reauthenticate', returnPath: '/account' });
    expect(started.status).toBe(201);

    t.clock.advanceMinutes(180);
    const deleted = await authed(account.token).post('/users/me/deletion').send({});
    expect(deleted.status).toBe(204);

    const tables = await tablesReferencingUsers();
    expect(tables.sort()).toEqual(['consents', 'identities', 'pending_identities', 'sessions']);
    for (const table of [...tables, 'users', 'oauth_states']) {
      expect(await countRows(t.db, table), table).toBe(0);
    }
  });

  it('con la sesión recién creada (alta), el borrado sin contraseña es directo', async () => {
    const account = await googleAccount();
    expect((await authed(account.token).post('/users/me/deletion').send({})).status).toBe(204);
    expect(await countRows(t.db, 'users')).toBe(0);
  });

  it('una contraseña en el cuerpo no cambia nada en una cuenta sin contraseña: se borra igual', async () => {
    const account = await googleAccount();
    const response = await authed(account.token)
      .post('/users/me/deletion')
      .send({ password: 'lo-que-sea-largo' });
    expect(response.status).toBe(204);
    expect(await countRows(t.db, 'users')).toBe(0);
  });
});
