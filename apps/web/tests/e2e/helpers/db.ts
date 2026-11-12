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

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
