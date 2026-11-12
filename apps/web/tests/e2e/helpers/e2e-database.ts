/**
 * URL de la base de datos de los e2e. Se niega con cualquier base cuyo nombre no termine en
 * `_e2e`. Mismo criterio que `apps/api/scripts/reset-db.ts`: se mira el nombre de la base en
 * la ruta de la URL, no la URL entera (que puede llevar `?sslmode=require` u otros parámetros).
 */
export function e2eDatabaseUrl(value: string | undefined = process.env.E2E_DATABASE_URL): string {
  let databaseName = '';
  try {
    databaseName = value ? new URL(value).pathname.slice(1) : '';
  } catch {
    // URL ilegible: cuenta como no válida.
  }
  if (!value || !/_e2e$/.test(databaseName)) {
    throw new Error('E2E_DATABASE_URL debe apuntar a una base de datos *_e2e');
  }
  return value;
}
