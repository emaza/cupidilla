import { error, fail, redirect } from '@sveltejs/kit';
import { errorMessages } from '#lib/errors/messages.ts';
import { api } from '#lib/server/api-client.ts';
import { urlMessage } from '#lib/server/oauth-notices.ts';
import { clearSessionCookie } from '#lib/server/session-cookie.ts';
import type { Actions, PageServerLoad } from './$types';

const acceptedOn = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Madrid',
});

export const load: PageServerLoad = async (event) => {
  const token = event.locals.sessionToken;
  const result = token ? await api.account(event, token) : null;

  if (result?.ok) {
    const consent = result.data.consents.find(
      (item) => item.purpose === 'service_use' && item.revokedAt === null,
    );
    return {
      message: urlMessage('account', event.url.searchParams),
      account: {
        email: result.data.user.email,
        terms: consent
          ? {
              version: consent.policyVersion,
              acceptedOn: acceptedOn.format(new Date(consent.grantedAt)),
            }
          : null,
      },
    };
  }
  if (!result || result.status === 401) {
    clearSessionCookie(event.cookies);
    redirect(303, '/login?next=/account');
  }
  // Sin JavaScript, tras un fallo al salir la página se vuelve a pintar: se muestra el aviso
  // de error aunque no se puedan cargar los datos. En una visita normal, página de error.
  if (event.request.method === 'POST') return { account: null, message: null };
  error(503, 'API unavailable');
};

export const actions = {
  logout: async (event) => {
    const token = event.locals.sessionToken;
    const result = token ? await api.logout(event, token) : null;

    // 204 o 401: la sesión ya no existe en la API. Si la API falla, no se dice «has salido» (A14).
    if (!result || result.ok || result.status === 401) {
      clearSessionCookie(event.cookies);
      event.locals.user = null;
      event.locals.sessionToken = null;
      redirect(303, '/?notice=signed-out');
    }
    return fail(503, { general: errorMessages.logout[result.error.code] });
  },
} satisfies Actions;
