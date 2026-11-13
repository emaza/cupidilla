import { error, fail, redirect } from '@sveltejs/kit';
import { errorMessages } from '#lib/errors/messages.ts';
import { textField } from '#lib/forms/form-data.ts';
import { signInMethodsView } from '#lib/server/account-view.ts';
import { api, configuredProviders } from '#lib/server/api-client.ts';
import { isProvider, urlMessage } from '#lib/server/oauth-notices.ts';
import { clearSessionCookie } from '#lib/server/session-cookie.ts';
import type { TextKey } from '#lib/texts.ts';
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
      signIn: signInMethodsView(result.data, await configuredProviders(event)),
    };
  }
  if (!result || result.status === 401) {
    clearSessionCookie(event.cookies);
    redirect(303, '/login?next=/account');
  }
  // Sin JavaScript, tras un fallo al salir la página se vuelve a pintar: se muestra el aviso
  // de error aunque no se puedan cargar los datos. En una visita normal, página de error.
  if (event.request.method === 'POST') return { account: null, message: null, signIn: null };
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

  /**
   * Quitar un proveedor (UX §3.5). Con contraseña en la cuenta, se escribe en el mismo formulario
   * (decisión 20); sin ella no se pide nada.
   */
  removeIdentity: async (event) => {
    const data = await event.request.formData();
    const provider = textField(data, 'provider');
    if (!isProvider(provider)) error(400, 'Invalid provider');
    const withPassword = textField(data, 'withPassword') === '1';
    const password = textField(data, 'password');
    const passwordError = (key: TextKey, status: number) =>
      fail(status, { removeError: { provider, password: key } });
    if (withPassword && password === '') return passwordError('cuenta.error.contrasena_vacia', 400);
    const token = event.locals.sessionToken;
    if (!token) redirect(303, '/login?next=/account');

    const result = await api.removeIdentity(
      event,
      token,
      provider,
      withPassword ? { password } : {},
    );
    if (result.ok) redirect(303, `/account?notice=unlinked&provider=${provider}`);
    switch (result.error.code) {
      case 'UNAUTHENTICATED':
        clearSessionCookie(event.cookies);
        redirect(303, '/login?next=/account');
        break;
      case 'PASSWORD_INCORRECT':
        return passwordError('cuenta.error.contrasena', 403);
      case 'VALIDATION_FAILED':
        return passwordError('cuenta.error.contrasena_vacia', 400);
      case 'LAST_SIGN_IN_METHOD':
        redirect(303, `/account?error=last-method&provider=${provider}`);
        break;
      case 'NOT_FOUND':
        // Ya no estaba unido (otra pestaña): la página muestra el estado actual.
        redirect(303, '/account');
        break;
      case 'RATE_LIMITED':
        redirect(303, '/account?error=rate-limited');
        break;
    }
    return fail(result.status, { removeFailed: provider });
  },
} satisfies Actions;
