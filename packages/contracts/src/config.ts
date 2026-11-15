import { z } from 'zod';
import { MIN_AGE_RANGE } from './age.js';

/** GET /config: ajustes públicos de la instalación. */
export const configResponseSchema = z.object({
  minAge: z.number().int().min(MIN_AGE_RANGE.min).max(MIN_AGE_RANGE.max),
  /** Correos opcionales (UX §6.9): la web decide con ellos qué textos pinta. */
  mail: z.object({ unverifiedReminder: z.boolean(), passwordChangedNotice: z.boolean() }),
});
export type ConfigResponse = z.infer<typeof configResponseSchema>;
