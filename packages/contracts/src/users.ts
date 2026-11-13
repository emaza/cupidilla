import { z } from 'zod';
import { passwordInputSchema, publicUserSchema, strictObjectError } from './auth.js';
import { consentSchema } from './consents.js';

/** Respuesta de GET /users/me. */
export const accountResponseSchema = z.object({
  user: publicUserSchema.extend({ birthDate: z.iso.date() }),
  consents: z.array(consentSchema),
});

export type AccountResponse = z.infer<typeof accountResponseSchema>;

/** Cuerpo de POST /users/me/deletion: volver a escribir la contraseña es la confirmación. */
export const deleteAccountRequestSchema = z.strictObject(
  { password: passwordInputSchema },
  { error: strictObjectError },
);

export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;
