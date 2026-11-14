import { displayMinAge } from '#lib/server/min-age.ts';
import type { LayoutServerLoad } from './$types';

/**
 * Solo se expone si hay sesión; ni el token ni el usuario completo llegan al navegador.
 * `minAge` es la edad mínima de la instalación, para los textos de todas las páginas.
 */
export const load: LayoutServerLoad = async (event) => ({
  signedIn: event.locals.user !== null,
  minAge: await displayMinAge(event),
});
