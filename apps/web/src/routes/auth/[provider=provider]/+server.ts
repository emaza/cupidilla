import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import type { OAuthProvider, OAuthStartResponse } from '@cupidilla/contracts';
import { textField } from '#lib/forms/form-data.ts';
import { api, type ApiResult } from '#lib/server/api-client.ts';
import { setOAuthToken } from '#lib/server/oauth-cookie.ts';
import { isReturnPath, safeReturnPath } from '#lib/server/return-path.ts';
import type { RequestHandler } from './$types';

/** Guarda el flowToken y va al proveedor; si la API falla, vuelve a `page` con el error. */
function goToProvider(
  event: RequestEvent,
  provider: OAuthProvider,
  page: string,
  result: ApiResult<OAuthStartResponse>,
): never {
  if (result.ok) {
    setOAuthToken(event.cookies, result.data.flowToken, result.data.expiresAt);
    // La URL la construye la API con endpoints de configuración, nunca con la petición (§12.2).
    redirect(303, result.data.authorizationUrl, { external: true });
  }
  if (result.status === 429) redirect(303, `${page}?error=rate-limited`);
  redirect(303, `${page}?error=provider-failed&provider=${provider}`);
}

/**
 * POST /auth/{provider}: empieza el flujo con el proveedor (técnico §11.1). Es un formulario
 * nativo (sin `use:enhance`) que acaba en un 303 a otro origen. La comprobación de `Origin` de
 * SvelteKit lo protege de CSRF.
 */
export const POST: RequestHandler = async (event) => {
  const { provider } = event.params;
  const data = await event.request.formData();
  const from = textField(data, 'from');
  const next = textField(data, 'next');

  if (from === 'login' || from === 'register') {
    // Con sesión, los botones de entrar no tienen sentido: a la cuenta.
    if (event.locals.user) redirect(303, '/account');
    const result = await api.oauthStart(event, provider, {
      entryPoint: from,
      ...(isReturnPath(next) ? { returnPath: next } : {}),
    });
    goToProvider(event, provider, `/${from}`, result);
  }

  if (from === 'account') {
    const intent = textField(data, 'intent');
    if (intent !== 'reauthenticate' && intent !== 'connect') error(400, 'Invalid intent');
    const page = safeReturnPath(next);
    const token = event.locals.sessionToken;
    if (!event.locals.user || !token) redirect(303, `/login?next=${page}`);
    // Añadir en una cuenta con contraseña: se escribe en el mismo formulario (decisión 20).
    const withPassword = textField(data, 'withPassword') === '1';
    const password = textField(data, 'password');
    if (withPassword && password === '') redirect(303, `${page}?error=password-required`);
    const result = await api.oauthSessionStart(event, token, provider, {
      purpose: intent,
      returnPath: page,
      ...(withPassword ? { password } : {}),
    });
    if (!result.ok) {
      if (result.status === 401) redirect(303, `/login?next=${page}`);
      // La contraseña no sale de la web: vuelve sin ir al proveedor.
      if (result.error.code === 'PASSWORD_INCORRECT') {
        redirect(303, `${page}?error=password-incorrect`);
      }
      if (result.error.code === 'VALIDATION_FAILED') {
        redirect(303, `${page}?error=password-required`);
      }
    }
    goToProvider(event, provider, page, result);
  }

  error(400, 'Invalid origin page');
};
