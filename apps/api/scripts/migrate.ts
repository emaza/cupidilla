// Aplica las migraciones de drizzle/ sobre DATABASE_URL. Es autónomo (sin importaciones
// relativas) para que Node 24 lo ejecute sin compilar.
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Falta la variable DATABASE_URL.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  await migrate(drizzle(pool), {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
  });
  console.log(`Migraciones aplicadas en ${new URL(databaseUrl).pathname.slice(1)}.`);
} finally {
  await pool.end();
}
