import { z } from 'zod';

/**
 * Comprobación antibots con ALTCHA (técnico de captcha §4.2). La API crea y verifica los retos;
 * la web solo pinta el widget y pasa la solución a la API en la cabecera `X-Captcha`.
 */

/** Nombre del campo del formulario (atributo `name` del widget). */
export const CAPTCHA_FIELD = 'captcha';
/** Cabecera con la que la web pasa la solución a la API (A3). Siempre en minúsculas. */
export const CAPTCHA_HEADER = 'x-captcha';
/** Una solución real ocupa unos 800 caracteres. Más allá, no se intenta leer. */
export const CAPTCHA_PAYLOAD_MAX = 4096;

const hex = z.string().regex(/^(?:[0-9a-f]{2})+$/);

/** Respuesta de GET /captcha/challenge (API y web). No admite nada más: ni `codeChallenge` ni `configuration`. */
export const captchaChallengeSchema = z.strictObject({
  parameters: z.strictObject({
    algorithm: z.literal('PBKDF2/SHA-256'),
    nonce: hex,
    salt: hex,
    cost: z.number().int().positive(),
    keyLength: z.number().int().positive(),
    keyPrefix: hex,
    keySignature: hex,
    // Segundos Unix.
    expiresAt: z.number().int().positive(),
  }),
  signature: hex,
});
export type CaptchaChallenge = z.infer<typeof captchaChallengeSchema>;

/** Lo que el widget pone en el campo: base64 de este JSON. Solo lo lee la API. */
export const captchaPayloadSchema = z.strictObject({
  challenge: captchaChallengeSchema,
  solution: z.strictObject({
    counter: z.number().int().nonnegative(),
    derivedKey: hex,
    time: z.number().nonnegative().optional(),
  }),
});
export type CaptchaPayload = z.infer<typeof captchaPayloadSchema>;
