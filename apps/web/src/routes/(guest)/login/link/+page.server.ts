import { passwordInputSchema } from '@cupidilla/contracts';
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { errorMessages, fieldMessages } from '#lib/errors/messages.ts';
import { firstIssueByField, textField, type FormErrors } from '#lib/forms/form-data.ts';
import { api } from '#lib/server/api-client.ts';
import { clearOAuthToken, getOAuthToken } from '#lib/server/oauth-cookie.ts';
import { safeReturnPath } from '#lib/server/return-path.ts';
import { setSessionCookie } from '#lib/server/session-cookie.ts';
import type { Actions, PageServerLoad } from './$types';

const EXPIRED = '/login?error=provider-expired';

type LinkErrors = FormErrors<'password'>;

/** Estado pendiente de la cookie, o el motivo por el que no lo hay. */
async function pendingLink(event: RequestEvent) {
  const token = getOAuthToken(event.cookies);
  if (!token) return { status: 'missing' as const };
  const result = await api.oauthPending(event, token);
  if (result.ok) return { status: 'ok' as const, token, pending: result.data };
  if (result.status === 400) return { status: 'missing' as const };
  return { status: 'unavailable' as const };
}

/** Sin estado válido o caducado: a /login con «ha pasado demasiado tiempo» (UX §2.1). */
function expired(event: RequestEvent): never {
  clearOAuthToken(event.cookies);
  redirect(303, EXPIRED);
}

export const load: PageServerLoad = async (event) => {
  event.setHeaders({ 'Cache-Control': 'no-store' });
  const state = await pendingLink(event);
  if (state.status === 'missing') expired(event);
  if (state.status === 'unavailable') error(503, 'API unavailable');
  if (state.pending.kind === 'signup') redirect(303, '/register/complete');
  return { pending: { provider: state.pending.provider, email: state.pending.email } };
};

export const actions = {
  link: async (event) => {
    const data = await event.request.formData();
    const parsed = passwordInputSchema.safeParse(textField(data, 'password'));
    if (!parsed.success) {
      const issue = firstIssueByField(
        parsed.error.issues.map((item) => ({ ...item, path: ['password'] })),
      ).get('password');
      const errors: LinkErrors = {
        fields: { password: fieldMessages.link.password[issue ?? 'required'] },
      };
      return fail(400, { errors });
    }

    // El correo que dio la API: el throttler lo usa para el cubo por correo de /auth/login (§8).
    const state = await pendingLink(event);
    if (state.status === 'missing') expired(event);
    if (state.status === 'unavailable') {
      return fail(503, { errors: { fields: {}, general: 'union.error.servidor' } as LinkErrors });
    }
    const { token, pending } = state;

    const result = await api.oauthLink(event, {
      pendingToken: token,
      email: pending.email,
      password: parsed.data,
    });
    if (result.ok) {
      clearOAuthToken(event.cookies);
      setSessionCookie(event.cookies, result.data.session.token, result.data.session.expiresAt);
      const page = safeReturnPath(result.data.returnPath);
      redirect(303, `${page}?notice=linked&provider=${pending.provider}`);
    }

    const { code } = result.error;
    if (code === 'OAUTH_FLOW_INVALID') expired(event);
    if (code === 'LINK_ATTEMPTS_EXCEEDED') {
      // El estado ya no existe: para reintentar hay que volver a pasar por el proveedor.
      clearOAuthToken(event.cookies);
      redirect(303, '/login?error=link-limit');
    }
    const message = errorMessages.link[code];
    // Contraseña incorrecta: en el campo y en el resumen, y el campo vacío (UX §3.3).
    const errors: LinkErrors =
      code === 'PASSWORD_INCORRECT' || code === 'VALIDATION_FAILED'
        ? { fields: { password: message } }
        : { fields: {}, general: message };
    return fail(result.status, { errors });
  },

  /** «Cancelar», en su propio formulario: descarta la unión pendiente. */
  cancel: async (event) => {
    const token = getOAuthToken(event.cookies);
    if (token) await api.oauthCancelPending(event, token);
    clearOAuthToken(event.cookies);
    redirect(303, '/login?notice=link-cancelled');
  },
} satisfies Actions;
