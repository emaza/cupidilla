import { redirect } from '@sveltejs/kit';
import { captchaFromForm } from '#lib/forms/form-data.ts';
import { api } from '#lib/server/api-client.ts';
import { getPendingEmail } from '#lib/server/email-cookies.ts';
import { urlMessage } from '#lib/server/oauth-notices.ts';
import type { Actions, PageServerLoad } from './$types';

/**
 * «Revisa tu correo» tras el alta (correo UX §3.1). El correo sale de la cookie, nunca de la URL;
 * sin ella (caducada, otra pestaña, «atrás» tras confirmar), de vuelta a /register sin mensaje.
 */
export const load: PageServerLoad = (event) => {
  const email = getPendingEmail(event.cookies, 'signup');
  if (!email) redirect(303, '/register');
  return {
    email,
    message: urlMessage('check-email-signup', event.url.searchParams, { correo: email }),
  };
};

export const actions = {
  /** Reenviar: respuesta uniforme, nunca dice si había algo que reenviar. */
  resend: async (event) => {
    const email = getPendingEmail(event.cookies, 'signup');
    if (!email) redirect(303, '/register');
    const captcha = captchaFromForm(await event.request.formData());
    const result = await api.requestEmailVerification(event, email, captcha);
    if (result.ok) redirect(303, '/register/check-email?notice=resent');
    if (result.error.code === 'CAPTCHA_REQUIRED')
      redirect(303, '/register/check-email?error=captcha-required');
    if (result.error.code === 'CAPTCHA_INVALID')
      redirect(303, '/register/check-email?error=captcha-invalid');
    if (result.status === 429) redirect(303, '/register/check-email?error=rate-limited');
    redirect(303, '/register/check-email?error=resend-failed');
  },
} satisfies Actions;
