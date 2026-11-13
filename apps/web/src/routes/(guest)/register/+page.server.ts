import { referenceToday } from '@cupidilla/contracts';
import { fail, redirect } from '@sveltejs/kit';
import { errorMessages } from '#lib/errors/messages.ts';
import { firstApiIssueByField } from '#lib/forms/form-data.ts';
import {
  hasErrors,
  parseRegisterForm,
  registerErrorsFromIssues,
  type RegisterErrors,
} from '#lib/forms/register.ts';
import { api, configuredProviders } from '#lib/server/api-client.ts';
import { urlMessage } from '#lib/server/oauth-notices.ts';
import { setSessionCookie } from '#lib/server/session-cookie.ts';
import type { Actions, PageServerLoad } from './$types';

/** Botones de los proveedores configurados y avisos de la URL (UX §3.1 y §3.4). */
export const load: PageServerLoad = async (event) => ({
  providers: await configuredProviders(event),
  message: urlMessage('entry', event.url.searchParams),
});

const onlyField = (fields: RegisterErrors['fields']): RegisterErrors => ({ fields, dateParts: [] });

export const actions = {
  default: async (event) => {
    const parsed = parseRegisterForm(await event.request.formData(), referenceToday(new Date()));

    // Con un menor no vuelve ningún valor y no se llama a la API (acuerdos A3 y A4).
    if (parsed.kind === 'underage') return fail(422, { underage: true as const });
    if (parsed.kind === 'invalid') {
      return fail(400, { values: parsed.values, errors: parsed.errors });
    }

    const { values } = parsed;
    const result = await api.register(event, parsed.request);
    if (result.ok) {
      setSessionCookie(event.cookies, result.data.session.token, result.data.session.expiresAt);
      redirect(303, '/account');
    }

    const { code, fields } = result.error;
    switch (code) {
      case 'UNDERAGE':
        return fail(422, { underage: true as const });
      case 'EMAIL_TAKEN':
        return fail(409, {
          values,
          errors: onlyField({ email: 'registro.error.correo_existente' }),
        });
      case 'TERMS_VERSION_OUTDATED':
        // La casilla vuelve desmarcada para que se lean y acepten las condiciones vigentes (A11).
        return fail(409, {
          values: { ...values, acceptTerms: false },
          errors: onlyField({ acceptTerms: 'registro.error.condiciones_version' }),
        });
      case 'VALIDATION_FAILED': {
        const errors = registerErrorsFromIssues(firstApiIssueByField(fields));
        if (hasErrors(errors)) return fail(400, { values, errors });
        break;
      }
    }
    const errors: RegisterErrors = {
      fields: {},
      dateParts: [],
      general: errorMessages.register[code],
    };
    return fail(result.status, { values, errors });
  },
} satisfies Actions;
