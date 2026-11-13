import { error, redirect } from '@sveltejs/kit';
import { textField } from '#lib/forms/form-data.ts';
import { api } from '#lib/server/api-client.ts';
import { setOAuthToken } from '#lib/server/oauth-cookie.ts';
import { isReturnPath } from '#lib/server/return-path.ts';
import type { RequestHandler } from './$types';

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

  if (from !== 'login' && from !== 'register') error(400, 'Invalid origin page');
  // Con sesión, los botones de entrar no tienen sentido: a la cuenta.
  if (event.locals.user) redirect(303, '/account');

  const result = await api.oauthStart(event, provider, {
    entryPoint: from,
    ...(isReturnPath(next) ? { returnPath: next } : {}),
  });
  if (result.ok) {
    setOAuthToken(event.cookies, result.data.flowToken, result.data.expiresAt);
    // La URL la construye la API con endpoints de configuración, nunca con la petición (§12.2).
    redirect(303, result.data.authorizationUrl, { external: true });
  }
  const value = result.status === 429 ? 'rate-limited' : 'provider-failed';
  redirect(303, `/${from}?error=${value}&provider=${provider}`);
};
