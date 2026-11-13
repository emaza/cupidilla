import type { LayoutServerLoad } from './$types';

/** Solo se expone si hay sesión; ni el token ni el usuario completo llegan al navegador. */
export const load: LayoutServerLoad = ({ locals }) => ({ signedIn: locals.user !== null });
