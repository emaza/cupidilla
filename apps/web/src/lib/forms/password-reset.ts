import { emailSchema, newPasswordSchema } from '@cupidilla/contracts';
import { fieldMessages } from '#lib/errors/messages.ts';
import type { TextKey } from '#lib/texts.ts';
import { firstIssueByField, textField } from './form-data.ts';

/**
 * /forgot-password (correo UX §3.3): el correo con las reglas y los textos del alta. Un correo con
 * formato válido siempre sigue adelante; no existe «no hemos encontrado ese correo».
 */
export function parseForgotForm(
  data: FormData,
): { kind: 'invalid'; email: string; error: TextKey } | { kind: 'valid'; email: string } {
  const email = textField(data, 'email');
  const parsed = emailSchema.safeParse(email);
  if (parsed.success) return { kind: 'valid', email: parsed.data };
  const issue = firstIssueByField(
    parsed.error.issues.map((item) => ({ ...item, path: ['email'] })),
  ).get('email');
  return { kind: 'invalid', email, error: fieldMessages.register.email[issue ?? 'invalid_format'] };
}

/**
 * /reset-password (correo UX §3.5): la contraseña nueva con las reglas y los textos del alta. La
 * contraseña nunca vuelve a la página.
 */
export function parseNewPassword(
  data: FormData,
): { kind: 'invalid'; error: TextKey } | { kind: 'valid'; password: string } {
  const parsed = newPasswordSchema.safeParse(textField(data, 'password'));
  if (parsed.success) return { kind: 'valid', password: parsed.data };
  const issue = firstIssueByField(
    parsed.error.issues.map((item) => ({ ...item, path: ['password'] })),
  ).get('password');
  return { kind: 'invalid', error: fieldMessages.register.password[issue ?? 'required'] };
}
