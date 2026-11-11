import { defineEnvVars } from '@sveltejs/kit/env';
import { z } from 'zod';

export const variables = defineEnvVars({
  API_URL: {
    description: 'URL base de la API NestJS (solo la usa el servidor de SvelteKit).',
    schema: z.url(),
  },
  INTERNAL_API_KEY: {
    description: 'Clave compartida que la API exige en X-Internal-Api-Key.',
    schema: z.string().min(32),
  },
});
