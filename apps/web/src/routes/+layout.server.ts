import { displayMinAge } from '#lib/server/min-age.ts';
import type { LayoutServerLoad } from './$types';

/** Páginas sin la banda de correo sin confirmar: ya hablan del correo (correo UX §3.7). */
const NO_EMAIL_BANNER = new Set(['/(private)/account', '/verify-email']);

/**
 * Solo se expone si hay sesión; ni el token ni el usuario completo llegan al navegador.
 * `minAge` es la edad mínima de la instalación, para los textos de todas las páginas.
 * `emailVerified` es `null` sin sesión.
 */
export const load: LayoutServerLoad = async (event) => {
  const user = event.locals.user;
  return {
    signedIn: user !== null,
    emailVerified: user ? user.emailVerified : null,
    emailBanner: user !== null && !user.emailVerified && !NO_EMAIL_BANNER.has(event.route.id ?? ''),
    minAge: await displayMinAge(event),
  };
};
