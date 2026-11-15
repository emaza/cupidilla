import { PASSWORD_RESET_TTL_MINUTES } from '@cupidilla/contracts';
import { redirect } from '@sveltejs/kit';
import { api } from '#lib/server/api-client.ts';
import { getPendingEmail } from '#lib/server/email-cookies.ts';
import { urlMessage } from '#lib/server/oauth-notices.ts';
import type { Actions, PageServerLoad } from './$types';

const PAGE = '/forgot-password/check-email';

/** «1 hora»: el plazo del enlace sale de la constante de `contracts`, no del texto. */
const duration = (minutes: number): string =>
  minutes % 60 === 0
    ? `${minutes / 60} ${minutes === 60 ? 'hora' : 'horas'}`
    : `${minutes} minutos`;

/**
 * «Revisa tu correo» tras pedir el enlace (correo UX §3.4). El correo sale de la cookie, nunca de
 * la URL; sin ella, de vuelta a /forgot-password sin mensaje. El texto es siempre condicional.
 */
export const load: PageServerLoad = (event) => {
  const email = getPendingEmail(event.cookies, 'reset');
  if (!email) redirect(303, '/forgot-password');
  return {
    email,
    duration: duration(PASSWORD_RESET_TTL_MINUTES),
    message: urlMessage('check-email-reset', event.url.searchParams, { correo: email }),
  };
};

export const actions = {
  /** «Enviar otro enlace»: pedirlo otra vez, con la misma respuesta uniforme. */
  resend: async (event) => {
    const email = getPendingEmail(event.cookies, 'reset');
    if (!email) redirect(303, '/forgot-password');
    const result = await api.requestPasswordReset(event, email);
    if (result.ok) redirect(303, `${PAGE}?notice=resent`);
    if (result.status === 429) redirect(303, `${PAGE}?error=rate-limited`);
    redirect(303, `${PAGE}?error=resend-failed`);
  },
} satisfies Actions;
