import { error, fail, redirect } from '@sveltejs/kit';
import { errorMessages } from '#lib/errors/messages.ts';
import { parseDeleteAccountForm, type DeleteAccountField } from '#lib/forms/delete-account.ts';
import { textField, type FormErrors } from '#lib/forms/form-data.ts';
import { signInMethodsView } from '#lib/server/account-view.ts';
import { api, type ApiResult } from '#lib/server/api-client.ts';
import { urlMessage } from '#lib/server/oauth-notices.ts';
import { clearSessionCookie } from '#lib/server/session-cookie.ts';
import type { TextKey } from '#lib/texts.ts';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

const PAGE = '/account/delete';

/** Palabra de confirmación sin contraseña (UX §3.6): sin distinguir mayúsculas ni espacios. */
const CONFIRMATION_WORD = 'ELIMINAR';

export const load: PageServerLoad = async (event) => {
  const { locals, request } = event;
  // Si no se pudo comprobar la sesión porque la API no responde, se muestra la página de error.
  if (locals.sessionUnavailable && request.method === 'GET') error(503, 'API unavailable');
  const token = locals.sessionToken;
  const result = token ? await api.account(event, token) : null;
  if (result?.ok) {
    return {
      signIn: signInMethodsView(result.data, []),
      message: urlMessage('account-step', event.url.searchParams),
    };
  }
  // Tras enviar, se vuelve a pintar el formulario con su error aunque no se puedan leer los
  // datos: con un borrado incierto la cuenta puede no existir ya (401), y el aviso de
  // «no sabemos si se ha eliminado» tiene que verse igual (H0 §3.5).
  if (request.method === 'POST') return { signIn: null, message: null };
  if (!result || result.status === 401) {
    clearSessionCookie(event.cookies);
    redirect(303, `/login?next=${PAGE}`);
  }
  error(503, 'API unavailable');
};

type Errors = FormErrors<DeleteAccountField | 'confirmation'>;

/** Lo común tras pedir el borrado a la API: éxito, sesión perdida o sesión envejecida. */
function afterDeletion(event: RequestEvent, result: ApiResult<void> | null): void {
  if (!result || (!result.ok && result.status === 401)) {
    // Sesión caducada o cuenta ya eliminada en otra pestaña: como sin sesión (UX §1.7).
    clearSessionCookie(event.cookies);
    event.locals.user = null;
    redirect(303, '/login?next=/account');
  }
  if (result.ok) {
    clearSessionCookie(event.cookies);
    event.locals.user = null;
    event.locals.sessionToken = null;
    redirect(303, '/?notice=account-deleted');
  }
  if (result.error.code === 'REAUTHENTICATION_REQUIRED') {
    // La sesión envejeció entre cargar y enviar: nada se ha borrado (UX §3.5.2).
    redirect(303, `${PAGE}?error=reauth-required`);
  }
}

export const actions = {
  /** Con contraseña: H0 sin cambios (UX §3.6). */
  password: async (event) => {
    const parsed = parseDeleteAccountForm(await event.request.formData());
    if (parsed.kind === 'invalid') return fail(400, { errors: parsed.errors as Errors });

    const token = event.locals.sessionToken;
    const result = token ? await api.deleteAccount(event, token, parsed.request) : null;
    afterDeletion(event, result);
    if (!result || result.ok) return;

    const message = errorMessages.delete[result.error.code];
    // Contraseña incorrecta: el error va en el campo y en el resumen (UX §3.5).
    const onField =
      result.error.code === 'PASSWORD_INCORRECT' || result.error.code === 'VALIDATION_FAILED';
    const errors: Errors = onField
      ? { fields: { password: message } }
      : { fields: {}, general: message };
    return fail(result.status, { errors });
  },

  /** Sin contraseña y con sesión reciente: escribir ELIMINAR (UX §3.6). La API no la necesita. */
  confirm: async (event) => {
    const word = textField(await event.request.formData(), 'confirmation');
    if (word.trim().toUpperCase() !== CONFIRMATION_WORD) {
      const errors: Errors = { fields: { confirmation: 'eliminar.error.confirmacion' } };
      return fail(400, { errors });
    }
    const token = event.locals.sessionToken;
    // El proveedor unido, para el texto de resultado incierto («entra con Google…»): tras el
    // borrado ya no se podría leer.
    const account = token ? await api.account(event, token) : null;
    const provider = account?.ok ? account.data.signInMethods.identities[0]?.provider : undefined;
    const result = token ? await api.deleteAccount(event, token, {}) : null;
    afterDeletion(event, result);
    if (!result || result.ok) return;

    const general: TextKey =
      result.error.code === 'OUTCOME_UNKNOWN'
        ? 'eliminar.error.resultado_incierto_proveedor'
        : errorMessages.delete[result.error.code];
    if (result.status === 429) redirect(303, `${PAGE}?error=rate-limited`);
    return fail(result.status, { errors: { fields: {}, general } as Errors, provider });
  },
} satisfies Actions;
