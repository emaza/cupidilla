import { deleteAccountRequestSchema, type DeleteAccountRequest } from '@cupidilla/contracts';
import { fieldMessages } from '#lib/errors/messages.ts';
import { firstIssueByField, textField, type FormErrors } from './form-data.ts';

export type DeleteAccountField = 'password';

export type DeleteAccountParse =
  | { kind: 'invalid'; errors: FormErrors<DeleteAccountField> }
  | { kind: 'valid'; request: DeleteAccountRequest };

/** Convierte el formulario de /account/delete al contrato. Solo se pide la contraseña (A9). */
export function parseDeleteAccountForm(data: FormData): DeleteAccountParse {
  const parsed = deleteAccountRequestSchema.safeParse({ password: textField(data, 'password') });
  if (parsed.success) return { kind: 'valid', request: parsed.data };
  const issue = firstIssueByField(parsed.error.issues).get('password') ?? 'invalid';
  return {
    kind: 'invalid',
    errors: { fields: { password: fieldMessages.delete.password[issue] } },
  };
}
