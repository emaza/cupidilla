import pg from 'pg';
import { e2eDatabaseUrl } from './e2e-database.ts';

let pool: pg.Pool | undefined;

function getPool(): pg.Pool {
  const connectionString = e2eDatabaseUrl();
  pool ??= new pg.Pool({ connectionString, max: 2 });
  return pool;
}

/** Filas de `users`, `sessions` y `consents` asociadas a un correo (ya normalizado). */
export async function rowsForEmail(
  email: string,
): Promise<{ users: number; sessions: number; consents: number }> {
  const { rows } = await getPool().query<{ users: string; sessions: string; consents: string }>(
    `select
       (select count(*) from users where email = $1)::text as users,
       (select count(*) from sessions s join users u on u.id = s.user_id where u.email = $1)::text as sessions,
       (select count(*) from consents c join users u on u.id = c.user_id where u.email = $1)::text as consents`,
    [email],
  );
  const row = rows[0];
  return {
    users: Number(row?.users),
    sessions: Number(row?.sessions),
    consents: Number(row?.consents),
  };
}

/** Filas de la entrada con proveedor asociadas a un correo (ya normalizado), en cualquier tabla. */
export async function oauthRowsForEmail(
  email: string,
): Promise<{ users: number; identities: number; pending: number }> {
  const { rows } = await getPool().query<{ users: string; identities: string; pending: string }>(
    `select
       (select count(*) from users where email = $1)::text as users,
       (select count(*) from identities where provider_email = $1)::text as identities,
       (select count(*) from pending_identities where provider_email = $1)::text as pending`,
    [email],
  );
  const row = rows[0];
  return {
    users: Number(row?.users),
    identities: Number(row?.identities),
    pending: Number(row?.pending),
  };
}

/** Revoca todas las sesiones de un correo (ya normalizado), como si hubieran caducado. */
export async function revokeSessionsForEmail(email: string): Promise<number> {
  const { rowCount } = await getPool().query(
    'delete from sessions where user_id in (select id from users where email = $1)',
    [email],
  );
  return rowCount ?? 0;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/** `users.email_verified_at` de un correo (ya normalizado), o `undefined` si no hay cuenta. */
export async function emailVerifiedAt(email: string): Promise<Date | null | undefined> {
  const { rows } = await getPool().query<{ email_verified_at: Date | null }>(
    'select email_verified_at from users where email = $1',
    [email],
  );
  return rows[0]?.email_verified_at;
}
