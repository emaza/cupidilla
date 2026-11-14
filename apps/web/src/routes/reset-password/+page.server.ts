import { opaqueTokenSchema } from '@cupidilla/contracts';
import { error, fail, redirect, type Cookies } from '@sveltejs/kit';
import { errorMessages, fieldMessages } from '#lib/errors/messages.ts';
import { firstApiIssueByField } from '#lib/forms/form-data.ts';
import { parseNewPassword } from '#lib/forms/password-reset.ts';
import { api } from '#lib/server/api-client.ts';
import {
  clearEmailToken,
  clearPendingEmail,
  getEmailToken,
  setEmailToken,
} from '#lib/server/email-cookies.ts';
import { setSessionCookie } from '#lib/server/session-cookie.ts';
import type { Actions, PageServerLoad } from './$types';

const PAGE = '/reset-password';

/** «Este enlace ya no sirve» detectado al cargar: la pantalla es el estado, con 410 (§9.1). */
function linkGone(cookies: Cookies): never {
  clearEmailToken(cookies, PAGE);
  error(410, 'Link no longer valid');
}

/**
 * /reset-password (técnico de correo §9.1, UX §3.5). El GET nunca consume nada: con `?token=`, lo
 * guarda en una cookie de esta ruta y hace un 303 sin consulta antes de pintar; después comprueba
 * el enlace con la API, para no pedir una contraseña con un enlace que ya no sirve.
 */
export const load: PageServerLoad = async (event) => {
  const { url, cookies, locals } = event;
  const raw = url.searchParams.get('token');
  if (raw !== null) {
    if (!opaqueTokenSchema.safeParse(raw).success) linkGone(cookies);
    setEmailToken(cookies, PAGE, raw);
    redirect(303, PAGE);
  }
  if (url.searchParams.get('error') === 'token-invalid') return { state: 'invalid' as const };

  const token = getEmailToken(cookies);
  if (!token) linkGone(cookies);
  const result = await api.inspectEmailToken(event, { token, purpose: 'reset_password' });
  if (result.ok) {
    return {
      state: 'form' as const,
      emailHint: result.data.emailHint,
      // Con cualquier sesión abierta: al terminar, el navegador pasa a la cuenta del enlace.
      signedIn: locals.user !== null,
    };
  }
  if (
    result.error.code === 'TOKEN_INVALID_OR_EXPIRED' ||
    result.error.code === 'VALIDATION_FAILED'
  ) {
    linkGone(cookies);
  }
  error(503, 'API unavailable');
};

export const actions = {
  /** Guardar la contraseña nueva: cierra las demás sesiones de la cuenta y abre una nueva. */
  default: async (event) => {
    const { cookies } = event;
    const token = getEmailToken(cookies);
    if (!token) redirect(303, `${PAGE}?error=token-invalid`);
    const parsed = parseNewPassword(await event.request.formData());
    if (parsed.kind === 'invalid') return fail(400, { passwordError: parsed.error });

    const result = await api.resetPassword(event, { token, password: parsed.password });
    if (result.ok) {
      clearEmailToken(cookies, PAGE);
      clearPendingEmail(cookies);
      // La sesión nueva sustituye a la que hubiera, aunque fuera de otra cuenta (decisión 8).
      const { user, session } = result.data;
      setSessionCookie(cookies, session.token, session.expiresAt);
      redirect(
        303,
        user.dataReviewRequired
          ? '/account/review?notice=password-reset'
          : '/account?notice=password-reset',
      );
    }

    const { code, fields } = result.error;
    if (code === 'TOKEN_INVALID_OR_EXPIRED') {
      clearEmailToken(cookies, PAGE);
      redirect(303, `${PAGE}?error=token-invalid`);
    }
    if (code === 'VALIDATION_FAILED') {
      const issue = firstApiIssueByField(fields).get('password');
      if (issue) return fail(400, { passwordError: fieldMessages.register.password[issue] });
    }
    return fail(result.status, { general: errorMessages.reset[code] });
  },
} satisfies Actions;
