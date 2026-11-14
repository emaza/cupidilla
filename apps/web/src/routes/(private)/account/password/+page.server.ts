import { oauthSessionStartRequestSchema } from '@cupidilla/contracts';
import { error, fail, redirect } from '@sveltejs/kit';
import { fieldMessages } from '#lib/errors/messages.ts';
import { firstIssueByField, textField } from '#lib/forms/form-data.ts';
import { signInMethodsView } from '#lib/server/account-view.ts';
import { api } from '#lib/server/api-client.ts';
import { setOAuthToken } from '#lib/server/oauth-cookie.ts';
import { isProvider, urlMessage } from '#lib/server/oauth-notices.ts';
import { clearSessionCookie } from '#lib/server/session-cookie.ts';
import type { TextKey } from '#lib/texts.ts';
import type { Actions, PageServerLoad } from './$types';

const PAGE = '/account/password';

/** Solo para cuentas sin contraseña (UX §3.7): si ya la tiene, a /account. */
export const load: PageServerLoad = async (event) => {
  const token = event.locals.sessionToken;
  const result = token ? await api.account(event, token) : null;
  if (!result || (!result.ok && result.status === 401)) {
    clearSessionCookie(event.cookies);
    redirect(303, `/login?next=${PAGE}`);
  }
  if (!result.ok) error(503, 'API unavailable');
  const signIn = signInMethodsView(result.data, []);
  if (signIn.hasPassword) redirect(303, '/account');
  return {
    email: result.data.user.email,
    signIn,
    message: urlMessage('account-step', event.url.searchParams),
  };
};

interface CreateErrors {
  password?: TextKey;
  general?: TextKey;
}

export const actions = {
  /**
   * Crear la contraseña (decisión 21): la API la cifra y la guarda en la fila de una
   * reautenticación con el proveedor unido; se crea al volver de él. Formulario nativo: acaba en
   * un 303 a otro origen.
   */
  create: async (event) => {
    const data = await event.request.formData();
    const provider = textField(data, 'provider');
    if (!isProvider(provider)) error(400, 'Invalid provider');
    const parsed = oauthSessionStartRequestSchema.safeParse({
      purpose: 'create_password',
      password: textField(data, 'password'),
      returnPath: PAGE,
    });
    if (!parsed.success) {
      const issue = firstIssueByField(parsed.error.issues).get('password') ?? 'invalid';
      const errors: CreateErrors = { password: fieldMessages.register.password[issue] };
      return fail(400, { errors });
    }
    const token = event.locals.sessionToken;
    if (!token) redirect(303, `/login?next=${PAGE}`);

    const result = await api.oauthSessionStart(event, token, provider, parsed.data);
    if (result.ok) {
      setOAuthToken(event.cookies, result.data.flowToken, result.data.expiresAt);
      // La URL la construye la API con endpoints de configuración, nunca con la petición (§12.2).
      redirect(303, result.data.authorizationUrl, { external: true });
    }
    const fail_ = (status: number, errors: CreateErrors) => fail(status, { errors });
    switch (result.error.code) {
      case 'UNAUTHENTICATED':
        clearSessionCookie(event.cookies);
        redirect(303, `/login?next=${PAGE}`);
        break;
      case 'PASSWORD_ALREADY_SET':
        redirect(303, '/account');
        break;
      case 'NOT_FOUND':
        // El proveedor ya no está unido (otra pestaña): la página muestra el estado actual.
        redirect(303, PAGE);
        break;
      case 'VALIDATION_FAILED': {
        const issue = result.error.fields?.find((field) => field.path === 'password')?.issue;
        if (issue) return fail_(400, { password: fieldMessages.register.password[issue] });
        break;
      }
      case 'RATE_LIMITED':
        return fail_(429, { general: 'comun.error.limite' });
    }
    return fail_(result.status, { general: 'contrasena.error.servidor' });
  },
} satisfies Actions;
