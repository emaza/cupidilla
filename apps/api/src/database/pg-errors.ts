import { DrizzleQueryError } from 'drizzle-orm';

/**
 * El error del driver: Drizzle envuelve el de pg en `DrizzleQueryError` y deja el original en
 * `cause`. Solo se desenvuelve ese: otros errores de pg también llevan `cause` (p. ej. el de
 * tiempo de conexión agotado envuelve el del intento) y deben clasificarse por sí mismos.
 */
function driverError(error: unknown): unknown {
  return error instanceof DrizzleQueryError ? error.cause : error;
}

/**
 * ¿Es una violación de unicidad (23505) de esa restricción? Drizzle envuelve el error del
 * driver en `DrizzleQueryError` y deja el original en `cause`.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  if (!cause || typeof cause !== 'object') return false;
  const { code, constraint: name } = cause as { code?: unknown; constraint?: unknown };
  return code === '23505' && name === constraint;
}

/** Errores de la fase de adquisición de un cliente: con ellos no se llegó a enviar ninguna sentencia. */
const notSent = new WeakSet<object>();

/** Marca un error como de adquisición (lo hace el pool de `createPool`). Devuelve el mismo error. */
export function markNotSent<T>(error: T): T {
  if (typeof error === 'object' && error !== null) notSent.add(error);
  return error;
}

/** Errores de red de Node que pueden llegar con la consulta ya enviada. */
const LOST_SOCKET_CODES = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT']);
/**
 * PostgreSQL terminó la sesión: admin_shutdown y crash_shutdown. No está 57P03
 * (cannot_connect_now): solo ocurre al conectar, sin nada enviado.
 */
const TERMINATED_CODES = new Set(['57P01', '57P02']);

/**
 * ¿Se perdió la conexión con PostgreSQL (o dejó de responder) con una consulta en marcha?
 * Entonces no se sabe si la operación se hizo: el COMMIT o un DELETE con autocommit pueden haber
 * llegado al servidor sin que llegue su respuesta (§7.2).
 *
 * No lo son, porque no se llegó a enviar nada: cualquier error de la adquisición del cliente
 * (`markNotSent`: no conseguir conexión a tiempo, un rechazo al conectar, un 57P01 o 57P03 en el
 * saludo…), 57P03 en cualquier caso y un cliente que ya no admite consultas («is not
 * queryable»). Tampoco un `statement_timeout` (57014) ni un 25P03: los cancela el servidor y
 * deshace la transacción.
 */
export function isConnectionLost(error: unknown): boolean {
  const cause = driverError(error);
  if (!(cause instanceof Error) || notSent.has(cause)) return false;
  const code = (cause as { code?: unknown }).code;
  if (typeof code === 'string') {
    if (LOST_SOCKET_CODES.has(code) || TERMINATED_CODES.has(code)) return true;
    // Clase 08: excepciones de conexión.
    if (/^08[0-9A-Z]{3}$/.test(code)) return true;
  }
  if (cause.message === 'Query read timeout') return true; // query_timeout del cliente
  return (
    cause.message.startsWith('Connection terminated') &&
    cause.message !== 'Connection terminated due to connection timeout'
  );
}
