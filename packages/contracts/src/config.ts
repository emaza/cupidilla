import { z } from 'zod';
import { MIN_AGE_RANGE } from './age.js';

/** GET /config: ajustes públicos de la instalación. */
export const configResponseSchema = z.object({
  minAge: z.number().int().min(MIN_AGE_RANGE.min).max(MIN_AGE_RANGE.max),
  /** Correos opcionales (UX §6.9): la web decide con ellos qué textos pinta. */
  mail: z.object({ unverifiedReminder: z.boolean(), passwordChangedNotice: z.boolean() }),
  /** Acuse al remitente del formulario de contacto (`CONTACT_ACK_EMAIL`). */
  contact: z.object({ ackEmail: z.boolean() }),
  /** Comprobación antibots (`CAPTCHA_ENABLED`, técnico de captcha §5.2). La API sigue decidiendo. */
  captcha: z.object({ enabled: z.boolean() }),
  /** Dirección de soporte (`MAIL_SUPPORT_ADDRESS`): la otra vía sin JavaScript (técnico de captcha §7.2). */
  support: z.object({ email: z.string() }),
});
export type ConfigResponse = z.infer<typeof configResponseSchema>;
