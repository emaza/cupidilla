import { z } from 'zod';

/** Finalidades de consentimiento conocidas. Añadir una exige también una migración de la CHECK. */
export const CONSENT_PURPOSES = ['service_use'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/**
 * Versión vigente del texto de /legal/terms. La exigen las altas nuevas (con correo o con
 * proveedor); a quien aceptó una anterior no se le vuelve a pedir (técnico terceros §13).
 */
export const SERVICE_TERMS_VERSION = '2026-11-borrador-2';

export const consentSchema = z.object({
  purpose: z.enum(CONSENT_PURPOSES),
  policyVersion: z.string(),
  grantedAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
});

export type Consent = z.infer<typeof consentSchema>;
