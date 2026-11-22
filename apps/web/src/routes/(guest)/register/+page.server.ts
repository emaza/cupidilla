import { MIN_AGE_RANGE, referenceToday } from '@cupidilla/contracts';
import { fail, redirect } from '@sveltejs/kit';
import { errorMessages, isCaptchaError } from '#lib/errors/messages.ts';
import { captchaFailure, captchaFailuresFrom } from '#lib/forms/captcha.ts';
import { captchaFromForm, firstApiIssueByField } from '#lib/forms/form-data.ts';
import {
  hasErrors,
  parseRegisterForm,
  registerValues,
  registerErrorsFromIssues,
  type RegisterErrors,
} from '#lib/forms/register.ts';
import { api, configuredProviders } from '#lib/server/api-client.ts';
import { currentMinAge } from '#lib/server/min-age.ts';
import { setPendingEmail } from '#lib/server/email-cookies.ts';
import { urlMessage } from '#lib/server/oauth-notices.ts';
import type { Actions, PageServerLoad } from './$types';

/** Botones de los proveedores configurados y avisos de la URL (UX §3.1 y §3.4). */
export const load: PageServerLoad = async (event) => ({
  providers: await configuredProviders(event),
  message: urlMessage('entry', event.url.searchParams),
});

const onlyField = (fields: RegisterErrors['fields']): RegisterErrors => ({ fields, dateParts: [] });

export const actions = {
  default: async (event) => {
    const data = await event.request.formData();
    const knownMinAge = await currentMinAge(event);
    // Sin la edad mínima se valida con el suelo del rango (nunca baja de él): un menor de ese
    // suelo lo es con cualquier configuración. El resto, como con la API caída (la API decide).
    const parsed = parseRegisterForm(
      data,
      referenceToday(new Date()),
      knownMinAge ?? MIN_AGE_RANGE.min,
    );

    // Con un menor no vuelve ningún valor y no se llama a la API (acuerdos A3 y A4).
    if (parsed.kind === 'underage') return fail(422, { underage: true as const });
    const captchaFailures = captchaFailuresFrom(data);
    if (knownMinAge === null) {
      const errors: RegisterErrors = {
        fields: {},
        dateParts: [],
        general: errorMessages.register.API_UNAVAILABLE,
      };
      return fail(503, { values: registerValues(data), errors, captchaFailures });
    }
    if (parsed.kind === 'invalid') {
      return fail(400, { values: parsed.values, errors: parsed.errors, captchaFailures });
    }

    const { values } = parsed;
    const result = await api.register(event, parsed.request, captchaFromForm(data));
    if (result.ok) {
      // Registro uniforme (correo §5.1): sin sesión y sin el correo en la URL. La cookie se pone
      // igual exista o no la cuenta.
      setPendingEmail(event.cookies, 'signup', parsed.request.email);
      redirect(303, '/register/check-email');
    }

    const { code, fields } = result.error;
    if (isCaptchaError(code)) {
      // En el campo de la comprobación, con los valores conservados (técnico de captcha §6, paso 7).
      const failure = captchaFailure(code, data);
      return fail(400, {
        values,
        errors: onlyField({ captcha: failure.key }),
        captchaFailures: failure.failures,
      });
    }
    switch (code) {
      case 'UNDERAGE':
        return fail(422, { underage: true as const });
      case 'TERMS_VERSION_OUTDATED':
        // La casilla vuelve desmarcada para que se lean y acepten las condiciones vigentes (A11).
        return fail(409, {
          values: { ...values, acceptTerms: false },
          errors: onlyField({ acceptTerms: 'registro.error.condiciones_version' }),
          captchaFailures,
        });
      case 'VALIDATION_FAILED': {
        const errors = registerErrorsFromIssues(firstApiIssueByField(fields));
        if (hasErrors(errors)) return fail(400, { values, errors, captchaFailures });
        break;
      }
    }
    const errors: RegisterErrors = {
      fields: {},
      dateParts: [],
      general: errorMessages.register[code],
    };
    return fail(result.status, { values, errors, captchaFailures });
  },
} satisfies Actions;
