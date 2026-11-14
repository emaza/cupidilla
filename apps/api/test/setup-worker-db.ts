import { INT_MAX_WORKERS, workerDatabaseUrl } from './helpers/test-databases.js';

// Cada worker de Vitest usa su propia base (creada en global-setup) para poder correr en paralelo.
// Va antes de importar AppModule, que lee DATABASE_URL al cargarse.
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error('Falta TEST_DATABASE_URL en el entorno de la integración.');
const workerId = Number(process.env.VITEST_POOL_ID ?? 1);
if (workerId > INT_MAX_WORKERS) {
  throw new Error(
    `VITEST_POOL_ID=${workerId} supera INT_MAX_WORKERS=${INT_MAX_WORKERS}: ejecuta con INT_MAX_WORKERS=N para crear N bases.`,
  );
}
const url = workerDatabaseUrl(base, workerId);
process.env.DATABASE_URL = url;
process.env.TEST_DATABASE_URL = url;
