// Vacía por completo una base de datos de pruebas (*_test o *_e2e). Se niega con cualquier otra.
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Falta la variable DATABASE_URL.');
  process.exit(1);
}

// Sin `new URL` directo: su TypeError lleva la URL (con la contraseña) en `input`.
if (!URL.canParse(databaseUrl)) {
  console.error('DATABASE_URL no es una URL válida.');
  process.exit(1);
}
const databaseName = new URL(databaseUrl).pathname.slice(1);
if (!/_(test|e2e)$/.test(databaseName)) {
  console.error(
    `reset-db se niega a vaciar «${databaseName}»: solo vale para bases terminadas en _test o _e2e.`,
  );
  process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query(
    'DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;',
  );
  console.log(`Base de datos ${databaseName} vaciada.`);
} finally {
  await client.end();
}
