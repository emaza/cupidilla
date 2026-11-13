import { defineParams } from '@sveltejs/kit/params';

/** Matchers de parámetros de ruta (SvelteKit 3). Un valor que no encaja es un 404. */
export const params = defineParams({
  /** `/auth/google` y `/auth/facebook` (técnico §11.1). */
  provider: (param) => (param === 'google' || param === 'facebook' ? param : undefined),
});
