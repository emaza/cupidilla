import { loginRequestSchema, type LoginRequest } from '@cupidilla/contracts';
import { fieldMessages } from '#lib/errors/messages.ts';
import { textField, type FormErrors } from './form-data.ts';

export type LoginField = 'email' | 'password';

export interface LoginValues {
  email: string;
}

export type LoginParse =
  | { kind: 'invalid'; values: LoginValues; errors: FormErrors<LoginField> }
  | { kind: 'valid'; values: LoginValues; request: LoginRequest };

/**
 * Convierte el formulario de /login al contrato. Solo un campo vacío da error por campo;
 * cualquier otro problema (correo mal formado, contraseña demasiado larga) se muestra como
 * credenciales incorrectas y no llega a la API (acuerdo A10).
 */
export function parseLoginForm(data: FormData): LoginParse {
  const values: LoginValues = { email: textField(data, 'email') };
  const password = textField(data, 'password');

  const errors: FormErrors<LoginField> = { fields: {} };
  if (values.email.trim() === '') errors.fields.email = fieldMessages.login.email.required;
  if (password === '') errors.fields.password = fieldMessages.login.password.required;
  if (errors.fields.email || errors.fields.password) return { kind: 'invalid', values, errors };

  const parsed = loginRequestSchema.safeParse({ email: values.email, password });
  if (!parsed.success) {
    return {
      kind: 'invalid',
      values,
      errors: { fields: {}, general: 'entrar.error.credenciales' },
    };
  }
  return { kind: 'valid', values, request: parsed.data };
}
