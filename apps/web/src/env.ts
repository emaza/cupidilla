import { defineEnvVars } from '@sveltejs/kit/env';
import { z } from 'zod';

export const variables = defineEnvVars({
  API_URL: {
    description: 'URL base de la API NestJS (solo la usa el servidor de SvelteKit).',
    schema: z.url(),
  },
  API_URL_ALLOW_HTTP: {
    description:
      'Permite API_URL con http: fuera de loopback (solo en una red privada de contenedores). Por defecto, false.',
    schema: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
  },
  INTERNAL_API_KEY: {
    description: 'Clave compartida que la API exige en X-Internal-Api-Key.',
    schema: z.string().min(32),
  },
});
