import { fail, redirect } from '@sveltejs/kit';
import { errorMessages } from '#lib/errors/messages.ts';
import { textField } from '#lib/forms/form-data.ts';
import type { FormErrors } from '#lib/forms/form-data.ts';
import { parseLoginForm, type LoginField } from '#lib/forms/login.ts';
import { api, configuredProviders } from '#lib/server/api-client.ts';
import { urlMessage } from '#lib/server/oauth-notices.ts';
import { isReturnPath, safeReturnPath } from '#lib/server/return-path.ts';
import { setSessionCookie } from '#lib/server/session-cookie.ts';
import type { Actions, PageServerLoad } from './$types';

/**
 * `next` solo se conserva si es una ruta de la lista cerrada (acuerdo A6). Los botones de
 * proveedor solo se dibujan para los configurados (UX §3.1.3).
 */
export const load: PageServerLoad = async (event) => {
  const next = event.url.searchParams.get('next');
  return {
    next: isReturnPath(next) ? next : null,
    providers: await configuredProviders(event),
    message: urlMessage('entry', event.url.searchParams),
  };
};

export const actions = {
  default: async (event) => {
    const data = await event.request.formData();
    const next = textField(data, 'next');
    const parsed = parseLoginForm(data);
    if (parsed.kind === 'invalid') {
      const status = parsed.errors.general ? 401 : 400;
      return fail(status, { values: parsed.values, errors: parsed.errors });
    }

    const result = await api.login(event, parsed.request);
    if (result.ok) {
      setSessionCookie(event.cookies, result.data.session.token, result.data.session.expiresAt);
      redirect(303, safeReturnPath(next));
    }
    const errors: FormErrors<LoginField> = {
      fields: {},
      general: errorMessages.login[result.error.code],
    };
    return fail(result.status, { values: parsed.values, errors });
  },
} satisfies Actions;
