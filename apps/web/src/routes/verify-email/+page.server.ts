import { opaqueTokenSchema } from '@cupidilla/contracts';
import { error, fail, redirect } from '@sveltejs/kit';
import { errorMessages } from '#lib/errors/messages.ts';
import { textField } from '#lib/forms/form-data.ts';
import { api } from '#lib/server/api-client.ts';
import {
  clearEmailToken,
  clearPendingEmail,
  getEmailToken,
  setEmailToken,
} from '#lib/server/email-cookies.ts';
import { setSessionCookie } from '#lib/server/session-cookie.ts';
import type { TextKey } from '#lib/texts.ts';
import type { Actions, PageServerLoad } from './$types';

const PAGE = '/verify-email';

/** «Este enlace ya no sirve» detectado al cargar: la pantalla es el estado, con 410 (§9.1). */
function linkGone(cookies: Parameters<typeof clearEmailToken>[0]): never {
  clearEmailToken(cookies, PAGE);
  error(410, 'Link no longer valid');
}

/**
 * /verify-email (técnico de correo §9.1, UX §3.2). El GET nunca consume nada: con `?token=`, lo
 * guarda en una cookie de esta ruta y hace un 303 sin consulta antes de pintar; después comprueba
 * el enlace con la API (con la sesión, si la hay) para saber si hace falta la contraseña (K3).
 */
export const load: PageServerLoad = async (event) => {
  const { url, cookies, locals } = event;
  const raw = url.searchParams.get('token');
  if (raw !== null) {
    if (!opaqueTokenSchema.safeParse(raw).success) linkGone(cookies);
    setEmailToken(cookies, PAGE, raw);
    redirect(303, PAGE);
  }
  const shown = url.searchParams.get('error');
  if (shown === 'attempts-exceeded') return { state: 'attempts' as const };
  if (shown === 'token-invalid') return { state: 'invalid' as const };

  const token = getEmailToken(cookies);
  if (!token) linkGone(cookies);
  const result = await api.inspectEmailToken(
    event,
    { token, purpose: 'verify_email' },
    locals.sessionToken ?? undefined,
  );
  if (result.ok) {
    const { emailHint, sessionMatches } = result.data;
    return {
      state: 'form' as const,
      emailHint,
      needsPassword: !sessionMatches,
      otherSession: locals.user !== null && !sessionMatches,
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
  /** Confirmar: siempre un POST con botón, y la contraseña si no hay sesión de esa cuenta. */
  confirm: async (event) => {
    const { cookies, locals } = event;
    const token = getEmailToken(cookies);
    if (!token) redirect(303, `${PAGE}?error=token-invalid`);
    const data = await event.request.formData();
    const withPassword = textField(data, 'withPassword') === '1';
    const password = textField(data, 'password');
    const passwordError = (key: TextKey, status: number) => fail(status, { passwordError: key });
    if (withPassword && password === '') {
      return passwordError('confirmar.error.contrasena_vacia', 400);
    }

    const result = await api.verifyEmail(
      event,
      { token, ...(withPassword ? { password } : {}) },
      locals.sessionToken ?? undefined,
    );
    if (result.ok) {
      clearEmailToken(cookies, PAGE);
      const outcome = result.data;
      if (outcome.session === 'same') redirect(303, '/account?notice=email-verified');
      if (outcome.session === 'kept-other') redirect(303, '/account?notice=email-verified-other');
      setSessionCookie(cookies, outcome.auth.session.token, outcome.auth.session.expiresAt);
      clearPendingEmail(cookies);
      redirect(303, '/account?notice=email-verified-signin');
    }

    const { code } = result.error;
    switch (code) {
      case 'TOKEN_INVALID_OR_EXPIRED':
        clearEmailToken(cookies, PAGE);
        redirect(303, `${PAGE}?error=token-invalid`);
        break;
      case 'TOKEN_ATTEMPTS_EXCEEDED':
        clearEmailToken(cookies, PAGE);
        redirect(303, `${PAGE}?error=attempts-exceeded`);
        break;
      case 'PASSWORD_INCORRECT':
      case 'VALIDATION_FAILED':
        // Mismo texto para cualquier fallo de contraseña; al recargar, el campo aparece si falta.
        return passwordError(errorMessages.verify[code], result.status);
    }
    return fail(result.status, { general: errorMessages.verify[code] });
  },
} satisfies Actions;
