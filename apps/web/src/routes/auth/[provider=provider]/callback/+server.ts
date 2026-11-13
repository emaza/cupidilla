import { api } from '#lib/server/api-client.ts';
import { callbackOutcome } from '#lib/server/oauth-callback.ts';
import { clearOAuthToken, getOAuthToken, setOAuthToken } from '#lib/server/oauth-cookie.ts';
import { setSessionCookie } from '#lib/server/session-cookie.ts';
import type { RequestHandler } from './$types';

/** 303 que no se guarda en ninguna caché: la URL de la vuelta lleva el código del proveedor. */
const seeOther = (location: string): Response =>
  new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });

/**
 * GET /auth/{provider}/callback: la vuelta del proveedor (técnico §11.1). Nunca pinta HTML.
 * Reenvía a la API la consulta tal cual, sin interpretarla.
 */
export const GET: RequestHandler = async (event) => {
  const { provider } = event.params;
  const flowToken = getOAuthToken(event.cookies);
  // Sin la cookie no hay flujo que continuar: no se llama a la API.
  if (!flowToken) return seeOther('/login?error=provider-expired');

  const result = await api.oauthCallback(
    event,
    provider,
    { flowToken, callbackQuery: event.url.search.slice(1) },
    event.locals.sessionToken ?? undefined,
  );
  const outcome = callbackOutcome(provider, result);
  switch (outcome.kind) {
    case 'session':
      clearOAuthToken(event.cookies);
      setSessionCookie(event.cookies, outcome.session.token, outcome.session.expiresAt);
      break;
    case 'pending':
      setOAuthToken(event.cookies, outcome.pending.token, outcome.pending.expiresAt);
      break;
    case 'redirect':
      clearOAuthToken(event.cookies);
      break;
  }
  return seeOther(outcome.location);
};
