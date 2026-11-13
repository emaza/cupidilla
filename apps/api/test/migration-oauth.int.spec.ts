import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateOpaqueToken, hashOpaqueToken } from '../src/common/crypto/opaque-token.js';
import { PasswordService } from '../src/users/password.service.js';
import { api, createTestApp, truncateAll, type TestApp } from './helpers/test-app.js';

const MIGRATIONS = resolve(import.meta.dirname, '../drizzle');

/**
 * Migración 0001_oauth_identities sobre una base con datos de H0: se vacía cupidilla_test, se
 * aplica solo 0000_init, se crean una cuenta y sus sesiones, se aplica el resto y se entra.
 * Al terminar, la base queda con todas las migraciones, como la deja `global-setup`.
 */
describe('Migración 0001 sobre datos de H0 (§5.5)', () => {
  let pool: pg.Pool;
  let h0Folder: string;
  let t: TestApp | undefined;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    h0Folder = await mkdtemp(join(tmpdir(), 'cupidilla-h0-migrations-'));
    const journal = JSON.parse(await readFile(join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {
      entries: { tag: string }[];
    };
    const h0Entry = journal.entries.find((entry) => entry.tag === '0000_init');
    if (!h0Entry) throw new Error('Falta 0000_init en el journal');
    await mkdir(join(h0Folder, 'meta'));
    await writeFile(
      join(h0Folder, 'meta/_journal.json'),
      JSON.stringify({ ...journal, entries: [h0Entry] }),
    );
    await copyFile(join(MIGRATIONS, '0000_init.sql'), join(h0Folder, '0000_init.sql'));
  });

  afterAll(async () => {
    await t?.app.close();
    // Pase lo que pase, la base vuelve a tener todas las migraciones y ningún dato.
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });
    await truncateAll(drizzle(pool));
    await pool.end();
    await rm(h0Folder, { recursive: true, force: true });
  });

  it('conserva cuentas y sesiones; authenticated_at = created_at y se sigue entrando', async () => {
    await pool.query(
      'DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;',
    );
    await migrate(drizzle(pool), { migrationsFolder: h0Folder });

    // Datos con el esquema de H0, como los dejaría el registro de H0.
    const passwords = new PasswordService();
    await passwords.onModuleInit();
    const password = 'contraseña-de-h0';
    const passwordHash = await passwords.hash(password);
    const {
      rows: [user],
    } = await pool.query<{ id: string }>(
      `insert into users (email, password_hash, birth_date, created_at, updated_at)
       values ('h0@example.com', $1, '1990-05-05', '2026-11-01T08:00:00Z', '2026-11-01T08:00:00Z')
       returning id`,
      [passwordHash],
    );
    const userId = user!.id;
    await pool.query(
      `insert into consents (user_id, purpose, policy_version, granted_at)
       values ($1, 'service_use', '2026-11-borrador', '2026-11-01T08:00:00Z')`,
      [userId],
    );
    const token = generateOpaqueToken();
    const otherToken = generateOpaqueToken();
    await pool.query(
      `insert into sessions (token_hash, user_id, created_at, expires_at) values
       ($1, $3, '2026-11-01T08:00:00Z', '2026-12-01T08:00:00Z'),
       ($2, $3, '2026-11-05T19:30:00Z', '2026-12-05T19:30:00Z')`,
      [hashOpaqueToken(token), hashOpaqueToken(otherToken), userId],
    );

    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });

    const { rows: sessionRows } = await pool.query<{
      created_at: Date;
      authenticated_at: Date;
    }>('select created_at, authenticated_at from sessions order by created_at');
    expect(sessionRows.map((row) => row.authenticated_at.toISOString())).toEqual([
      '2026-11-01T08:00:00.000Z',
      '2026-11-05T19:30:00.000Z',
    ]);
    const { rows: userRows } = await pool.query<{ password_hash: string | null }>(
      'select password_hash from users',
    );
    expect(userRows).toEqual([{ password_hash: passwordHash }]);

    t = await createTestApp({ now: '2026-11-11T10:00:00.000Z' });
    const session = await api(t.app).get('/auth/session').set('Authorization', `Bearer ${token}`);
    expect(session.status).toBe(200);
    expect(session.body.user).toMatchObject({ id: userId, email: 'h0@example.com' });

    const account = await api(t.app).get('/users/me').set('Authorization', `Bearer ${otherToken}`);
    expect(account.status).toBe(200);
    expect(account.body.session).toEqual({ authenticatedAt: '2026-11-05T19:30:00.000Z' });
    expect(account.body.signInMethods).toEqual({ password: true, identities: [] });
    expect(account.body.consents).toMatchObject([{ policyVersion: '2026-11-borrador' }]);

    const login = await api(t.app).post('/auth/login').send({ email: 'h0@example.com', password });
    expect(login.status).toBe(200);
  });
});
