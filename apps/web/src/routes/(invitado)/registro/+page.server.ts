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
import { api } from '#lib/server/api-client.ts';
import { setSessionCookie } from '#lib/server/session-cookie.ts';
import type { Actions } from './$types';

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
      redirect(303, '/cuenta');
    }

    const { code, fields } = result.error;
    switch (code) {
      case 'UNDERAGE':
        return fail(422, { underage: true as const });
      case 'EMAIL_TAKEN':
        return fail(409, {
          values,
          errors: onlyField({ correo: 'registro.error.correo_existente' }),
        });
      case 'TERMS_VERSION_OUTDATED':
        // La casilla vuelve desmarcada para que se lean y acepten las condiciones vigentes (A11).
        return fail(409, {
          values: { ...values, condiciones: false },
          errors: onlyField({ condiciones: 'registro.error.condiciones_version' }),
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
      general: errorMessages.registro[code],
    };
    return fail(result.status, { values, errors });
  },
} satisfies Actions;
