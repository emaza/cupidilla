import type { ResolvedPathname } from '$app/types';

/**
 * Ruta ya resuelta con una consulta o un fragmento: `resolve()` no los admite. P. ej.
 * `withSuffix(resolve('account'), '#correo')`.
 */
export function withSuffix(
  path: ResolvedPathname,
  suffix: `?${string}` | `#${string}`,
): ResolvedPathname {
  return `${path}${suffix}` as ResolvedPathname;
}
