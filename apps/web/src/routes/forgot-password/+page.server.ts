import { fail, redirect } from '@sveltejs/kit';
import { errorMessages, isCaptchaError } from '#lib/errors/messages.ts';
import { captchaFailure, captchaFailuresFrom } from '#lib/forms/captcha.ts';
import { captchaFromForm } from '#lib/forms/form-data.ts';
import { parseForgotForm } from '#lib/forms/password-reset.ts';
import { api } from '#lib/server/api-client.ts';
import { setPendingEmail } from '#lib/server/email-cookies.ts';
import type { TextKey } from '#lib/texts.ts';
import type { Actions } from './$types';

type ForgotErrors = { email?: TextKey; captcha?: TextKey; general?: TextKey };

/**
 * /forgot-password (correo UX §3.3, técnico §9.1). Con o sin sesión: también sirve para crear una
 * contraseña. La respuesta es la misma exista o no la cuenta. Con la comprobación antibots
 * (técnico de captcha §6.2): `captcha` y `supportEmail` llegan del layout.
 */
export const actions = {
  default: async (event) => {
    const data = await event.request.formData();
    const parsed = parseForgotForm(data);
    const captchaFailures = captchaFailuresFrom(data);
    if (parsed.kind === 'invalid') {
      const errors: ForgotErrors = { email: parsed.error };
      return fail(400, { email: parsed.email, errors, captchaFailures });
    }
    const result = await api.requestPasswordReset(event, parsed.email, captchaFromForm(data));
    if (result.ok) {
      // Sin el correo en la URL; la cookie se pone igual exista o no la cuenta.
      setPendingEmail(event.cookies, 'reset', parsed.email);
      redirect(303, '/forgot-password/check-email');
    }
    const { code } = result.error;
    if (isCaptchaError(code)) {
      const failure = captchaFailure(code, data);
      const errors: ForgotErrors = { captcha: failure.key };
      return fail(400, { email: parsed.email, errors, captchaFailures: failure.failures });
    }
    const errors: ForgotErrors = { general: errorMessages.forgot[code] };
    return fail(result.status, { email: parsed.email, errors, captchaFailures });
  },
} satisfies Actions;
