/**
 * Rutas que se pueden usar con la revisión de datos pendiente (correo §5.11, UX §3.10): la propia
 * revisión, el borrado, las condiciones y las páginas de los enlaces de correo.
 */
const DATA_REVIEW_ROUTES = new Set([
  '/(private)/account/review',
  '/(private)/account/delete',
  '/legal/terms',
  '/verify-email',
  '/forgot-password',
  '/forgot-password/check-email',
  '/reset-password',
  // Reto antibots de /forgot-password (técnico de captcha §6.2).
  '/captcha/challenge',
]);

export const DATA_REVIEW_PATH = '/account/review';

/**
 * ¿Hay que llevar esta petición a /account/review? Con la revisión pendiente no se puede usar
 * nada más que las rutas exentas; la API lo refuerza con 403 `DATA_REVIEW_REQUIRED`. Decide por
 * `route.id`, como `guardRoutes`.
 */
export function mustReviewData(
  user: { dataReviewRequired: boolean } | null,
  routeId: string | null,
): boolean {
  return user?.dataReviewRequired === true && !DATA_REVIEW_ROUTES.has(routeId ?? '');
}
