import { error, fail, redirect } from '@sveltejs/kit';
import { errorMessages } from '#lib/errors/messages.ts';
import { parseDeleteAccountForm, type DeleteAccountField } from '#lib/forms/delete-account.ts';
import type { FormErrors } from '#lib/forms/form-data.ts';
import { api } from '#lib/server/api-client.ts';
import { clearSessionCookie } from '#lib/server/session-cookie.ts';
import type { Actions, PageServerLoad } from './$types';

/** Si no se pudo comprobar la sesión porque la API no responde, se muestra la página de error. */
export const load: PageServerLoad = ({ locals, request }) => {
  if (locals.sessionUnavailable && request.method === 'GET') error(503, 'API unavailable');
};

export const actions = {
  default: async (event) => {
    const parsed = parseDeleteAccountForm(await event.request.formData());
    if (parsed.kind === 'invalid') return fail(400, { errors: parsed.errors });

    const token = event.locals.sessionToken;
    const result = token ? await api.deleteAccount(event, token, parsed.request) : null;

    if (!result || (!result.ok && result.status === 401)) {
      // Sesión caducada o cuenta ya eliminada en otra pestaña: como sin sesión (UX §1.7).
      clearSessionCookie(event.cookies);
      event.locals.user = null;
      redirect(303, '/login?next=/account');
    }
    if (result.ok) {
      clearSessionCookie(event.cookies);
      event.locals.user = null;
      event.locals.sessionToken = null;
      redirect(303, '/?notice=account-deleted');
    }

    const message = errorMessages.delete[result.error.code];
    // Contraseña incorrecta: el error va en el campo y en el resumen (UX §3.5).
    const onField =
      result.error.code === 'PASSWORD_INCORRECT' || result.error.code === 'VALIDATION_FAILED';
    const errors: FormErrors<DeleteAccountField> = onField
      ? { fields: { password: message } }
      : { fields: {}, general: message };
    return fail(result.status, { errors });
  },
} satisfies Actions;
