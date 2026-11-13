import {
  OAUTH_PENDING_TTL_MINUTES,
  referenceToday,
  type OAuthProvider,
} from '@cupidilla/contracts';
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { errorMessages } from '#lib/errors/messages.ts';
import { firstApiIssueByField } from '#lib/forms/form-data.ts';
import {
  oauthSignupErrorsFromIssues,
  parseOAuthSignupForm,
  type OAuthSignupErrors,
} from '#lib/forms/oauth-signup.ts';
import { api } from '#lib/server/api-client.ts';
import { clearOAuthToken, getOAuthToken } from '#lib/server/oauth-cookie.ts';
import { safeReturnPath } from '#lib/server/return-path.ts';
import { setSessionCookie } from '#lib/server/session-cookie.ts';
import type { Actions, PageServerLoad } from './$types';

const EXPIRED = '/login?error=provider-expired';

/** Estado pendiente de la cookie; sin estado válido, a /login con «caducado» (UX §2.1). */
async function pendingSignup(event: RequestEvent) {
  const token = getOAuthToken(event.cookies);
  if (!token) return { status: 'missing' as const };
  const result = await api.oauthPending(event, token);
  if (result.ok) return { status: 'ok' as const, token, pending: result.data };
  if (result.status === 400) return { status: 'missing' as const };
  return { status: 'unavailable' as const };
}

export const load: PageServerLoad = async (event) => {
  // Depende de un estado temporal propio: nunca a ninguna caché (UX §2.1).
  event.setHeaders({ 'Cache-Control': 'no-store' });
  const state = await pendingSignup(event);
  if (state.status === 'ok') {
    if (state.pending.kind === 'link') redirect(303, '/login/link');
    return {
      pending: { provider: state.pending.provider, email: state.pending.email },
      minutes: OAUTH_PENDING_TTL_MINUTES,
    };
  }
  // Tras la pantalla de menor ya no hay estado: la página la pinta `form`.
  if (event.request.method === 'POST') return { pending: null, minutes: OAUTH_PENDING_TTL_MINUTES };
  if (state.status === 'missing') {
    clearOAuthToken(event.cookies);
    redirect(303, EXPIRED);
  }
  error(503, 'API unavailable');
};

/** Con un menor no se crea nada y se borra en el acto lo recibido del proveedor (UX §3.2.2). */
async function underage(event: RequestEvent, token: string, provider: OAuthProvider | null) {
  await api.oauthCancelPending(event, token);
  clearOAuthToken(event.cookies);
  return fail(422, { underage: true as const, provider });
}

export const actions = {
  default: async (event) => {
    const token = getOAuthToken(event.cookies);
    if (!token) redirect(303, EXPIRED);
    const data = await event.request.formData();
    const parsed = parseOAuthSignupForm(data, token, referenceToday(new Date()));

    if (parsed.kind === 'underage') {
      // El proveedor solo hace falta para la frase «No hemos guardado nada de tu cuenta de …».
      const lookup = await api.oauthPending(event, token);
      return underage(event, token, lookup.ok ? lookup.data.provider : null);
    }
    if (parsed.kind === 'invalid')
      return fail(400, { values: parsed.values, errors: parsed.errors });

    const { values } = parsed;
    const result = await api.oauthSignup(event, parsed.request);
    if (result.ok) {
      clearOAuthToken(event.cookies);
      setSessionCookie(event.cookies, result.data.session.token, result.data.session.expiresAt);
      redirect(303, safeReturnPath(result.data.returnPath));
    }

    const { code, fields } = result.error;
    switch (code) {
      case 'UNDERAGE':
        return underage(event, token, null);
      case 'OAUTH_FLOW_INVALID':
        clearOAuthToken(event.cookies);
        redirect(303, EXPIRED);
        break;
      case 'EMAIL_TAKEN':
        // Alguien creó la cuenta con contraseña mientras tanto: la API ya convirtió el estado
        // en una unión (UX §1.3). Sin error: la pantalla de unión lo explica.
        redirect(303, '/login/link');
        break;
      case 'ACCOUNT_USES_OTHER_PROVIDER':
        clearOAuthToken(event.cookies);
        redirect(303, '/login?error=other-provider');
        break;
      case 'TERMS_VERSION_OUTDATED': {
        // La casilla vuelve desmarcada para que se lean y acepten las vigentes (acuerdo A11).
        const errors: OAuthSignupErrors = {
          fields: { acceptTerms: 'registro.error.condiciones_version' },
          dateParts: [],
        };
        return fail(409, { values: { ...values, acceptTerms: false }, errors });
      }
      case 'VALIDATION_FAILED': {
        const errors = oauthSignupErrorsFromIssues(firstApiIssueByField(fields));
        if (Object.keys(errors.fields).length > 0) return fail(400, { values, errors });
        break;
      }
    }
    const errors: OAuthSignupErrors = {
      fields: {},
      dateParts: [],
      general: errorMessages.signup[code],
    };
    return fail(result.status, { values, errors });
  },

  /** «Cancelar», en su propio formulario: descarta el estado y vuelve a la pantalla de origen. */
  cancel: async (event) => {
    const token = getOAuthToken(event.cookies);
    let origin = 'login';
    if (token) {
      const lookup = await api.oauthPending(event, token);
      if (lookup.ok) origin = lookup.data.entryPoint;
      await api.oauthCancelPending(event, token);
    }
    clearOAuthToken(event.cookies);
    redirect(303, `/${origin}?notice=signup-cancelled`);
  },
} satisfies Actions;
