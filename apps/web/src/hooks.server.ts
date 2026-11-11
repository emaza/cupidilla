import { redirect } from '@sveltejs/kit';
import { sequence, type Handle, type HandleServerError } from '@sveltejs/kit/hooks';
import { api } from '#lib/server/api-client.ts';
import { DEFAULT_RETURN_PATH, safeReturnPath } from '#lib/server/return-path.ts';
import {
  clearSessionCookie,
  getSessionToken,
  setSessionCookie,
} from '#lib/server/session-cookie.ts';

/** Comprueba la cookie contra la API y rellena `locals`. */
const authenticate: Handle = async ({ event, resolve }) => {
  event.locals.user = null;
  event.locals.sessionToken = null;
  event.locals.sessionUnavailable = false;

  const token = getSessionToken(event.cookies);
  if (token) {
    const result = await api.session(event, token);
    if (result.ok) {
      const { user, session } = result.data;
      event.locals.user = { id: user.id, email: user.email };
      event.locals.sessionToken = token;
      if (session.renewed) setSessionCookie(event.cookies, token, session.expiresAt);
    } else if (result.status === 401) {
      clearSessionCookie(event.cookies);
    } else {
      // La API no ha respondido: no se borra la cookie y las páginas privadas muestran el error.
      event.locals.sessionToken = token;
      event.locals.sessionUnavailable = true;
    }
  }
  return resolve(event);
};

/** Decide por `route.id`, nunca por `url.pathname` (los grupos no cambian las URL). */
const guardRoutes: Handle = async ({ event, resolve }) => {
  const routeId = event.route.id ?? '';
  const { user, sessionUnavailable } = event.locals;

  if (routeId.startsWith('/(privado)') && !user && !sessionUnavailable) {
    // Al enviar un formulario con la sesión caducada se vuelve a /cuenta (UX §1.7).
    const next =
      event.request.method === 'GET' ? safeReturnPath(event.url.pathname) : DEFAULT_RETURN_PATH;
    redirect(303, `/entrar?siguiente=${next}`);
  }
  if (routeId.startsWith('/(invitado)') && user) {
    redirect(303, '/cuenta');
  }
  return resolve(event);
};

const securityHeaders: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  if (event.locals.user) {
    // Para que «atrás» no muestre la cuenta después de salir.
    response.headers.set('Cache-Control', 'private, no-store');
  }
  return response;
};

export const handle = sequence(authenticate, guardRoutes, securityHeaders);

/** Solo se registra lo imprescindible: nunca la petición, el formulario ni `locals` (§8.9). */
export const handleError: HandleServerError = ({ kind, error, event }) => {
  if (kind === 'unknown') {
    const { name, message } = error instanceof Error ? error : { name: 'Unknown', message: '' };
    console.error(JSON.stringify({ status: 500, routeId: event.route.id, name, message }));
  }
};
