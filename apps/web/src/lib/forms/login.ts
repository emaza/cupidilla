import { loginRequestSchema, type LoginRequest } from '@cupidilla/contracts';
import { fieldMessages } from '#lib/errors/messages.ts';
import { textField, type FormErrors } from './form-data.ts';

export type LoginField = 'correo' | 'contrasena';

export interface LoginValues {
  correo: string;
}

export type LoginParse =
  | { kind: 'invalid'; values: LoginValues; errors: FormErrors<LoginField> }
  | { kind: 'valid'; values: LoginValues; request: LoginRequest };

/**
 * Convierte el formulario de /entrar al contrato. Solo un campo vacío da error por campo;
 * cualquier otro problema (correo mal formado, contraseña demasiado larga) se muestra como
 * credenciales incorrectas y no llega a la API (acuerdo A10).
 */
export function parseLoginForm(data: FormData): LoginParse {
  const values: LoginValues = { correo: textField(data, 'correo') };
  const password = textField(data, 'contrasena');

  const errors: FormErrors<LoginField> = { fields: {} };
  if (values.correo.trim() === '') errors.fields.correo = fieldMessages.entrar.email.required;
  if (password === '') errors.fields.contrasena = fieldMessages.entrar.password.required;
  if (errors.fields.correo || errors.fields.contrasena) return { kind: 'invalid', values, errors };

  const parsed = loginRequestSchema.safeParse({ email: values.correo, password });
  if (!parsed.success) {
    return {
      kind: 'invalid',
      values,
      errors: { fields: {}, general: 'entrar.error.credenciales' },
    };
  }
  return { kind: 'valid', values, request: parsed.data };
}
