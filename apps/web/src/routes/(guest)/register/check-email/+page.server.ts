import { redirect } from '@sveltejs/kit';
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
    const result = await api.requestEmailVerification(event, email);
    if (result.ok) redirect(303, '/register/check-email?notice=resent');
    if (result.status === 429) redirect(303, '/register/check-email?error=rate-limited');
    redirect(303, '/register/check-email?error=resend-failed');
  },
} satisfies Actions;
