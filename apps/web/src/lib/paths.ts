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

/**
 * «¿Olvidaste tu contraseña?» (correo UX §3.2, §3.6). La página llega con la recuperación (fase C
 * del hito de correo); los enlaces de la fase B ya la nombran, como los correos. Cuando exista,
 * pasa a ser `resolve('forgot-password')`.
 */
export const FORGOT_PASSWORD_PATH = '/forgot-password' as ResolvedPathname;
