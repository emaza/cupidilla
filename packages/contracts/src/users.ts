import { z } from 'zod';
import {
  newPasswordSchema,
  passwordInputSchema,
  publicUserSchema,
  strictObjectError,
} from './auth.js';
import { consentSchema } from './consents.js';
import { OAUTH_PROVIDERS } from './oauth.js';

/** Respuesta de GET /users/me. */
export const accountResponseSchema = z.object({
  user: publicUserSchema.extend({ birthDate: z.iso.date() }),
  consents: z.array(consentSchema),
  /** Formas de entrar. Del proveedor solo se muestra la fecha de unión, no su correo. */
  signInMethods: z.object({
    password: z.boolean(),
    identities: z.array(
      z.object({ provider: z.enum(OAUTH_PROVIDERS), linkedAt: z.iso.datetime() }),
    ),
  }),
  /** La web decide con esto si la sesión es reciente; la API lo vuelve a comprobar siempre. */
  session: z.object({ authenticatedAt: z.iso.datetime() }),
});

export type AccountResponse = z.infer<typeof accountResponseSchema>;

/**
 * Cuerpo de POST /users/me/deletion. Con contraseña en la cuenta, volver a escribirla es la
 * confirmación y la API la exige; sin contraseña no se pide nada más que la palabra ELIMINAR, que
 * valida la web (decisión 20).
 */
export const deleteAccountRequestSchema = z.strictObject(
  { password: passwordInputSchema.optional() },
  { error: strictObjectError },
);

export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;

/** Cuerpo de POST /users/me/password: las mismas reglas que la contraseña del registro. */
export const createPasswordRequestSchema = z.strictObject(
  { password: newPasswordSchema },
  { error: strictObjectError },
);

export type CreatePasswordRequest = z.infer<typeof createPasswordRequestSchema>;

/** Cuerpo de POST /users/me/reauthentication. */
export const reauthenticateRequestSchema = z.strictObject(
  { password: passwordInputSchema },
  { error: strictObjectError },
);

export type ReauthenticateRequest = z.infer<typeof reauthenticateRequestSchema>;

/**
 * Cuerpo de POST /users/me/identities/:provider/removal. Una cuenta con contraseña la escribe
 * para confirmar; una sin contraseña no envía nada (decisión 20).
 */
export const removeIdentityRequestSchema = z.strictObject(
  { password: passwordInputSchema.optional() },
  { error: strictObjectError },
);

export type RemoveIdentityRequest = z.infer<typeof removeIdentityRequestSchema>;
