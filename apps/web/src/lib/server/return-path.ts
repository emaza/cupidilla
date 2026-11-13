/** Rutas privadas a las que se puede volver tras entrar (acuerdo A6). Lista cerrada. */
export const RETURN_PATHS = ['/account', '/account/delete'] as const;

export type ReturnPath = (typeof RETURN_PATHS)[number];

export const DEFAULT_RETURN_PATH: ReturnPath = '/account';

export function isReturnPath(value: unknown): value is ReturnPath {
  return typeof value === 'string' && (RETURN_PATHS as readonly string[]).includes(value);
}

/** Devuelve el valor solo si coincide exactamente con una ruta de la lista; si no, `/account`. */
export function safeReturnPath(value: unknown): ReturnPath {
  return isReturnPath(value) ? value : DEFAULT_RETURN_PATH;
}
