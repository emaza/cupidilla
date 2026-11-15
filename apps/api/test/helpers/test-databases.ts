/**
 * Una base de datos por worker de la integración: `cupidilla_test` -> `cupidilla_w1_test`...
 * y `cupidilla_e2e` -> `cupidilla_w1_e2e` (el sufijo se conserva porque reset-db solo vacía bases
 * terminadas en _test o _e2e).
 */
export const INT_MAX_WORKERS = Number(process.env.INT_MAX_WORKERS ?? 4);

export function workerDatabaseName(baseName: string, workerId: number): string {
  return baseName.replace(/_(test|e2e)$/, `_w${workerId}_$1`);
}

export function workerDatabaseUrl(baseUrl: string, workerId: number): string {
  const url = new URL(baseUrl);
  url.pathname = `/${workerDatabaseName(url.pathname.slice(1), workerId)}`;
  return url.toString();
}
