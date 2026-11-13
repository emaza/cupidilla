import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/env';

/** La cookie la pone y la quita solo SvelteKit (§8.3). La API nunca pone cookies. */
export const SESSION_COOKIE = 'cupidilla_session';

const options = { path: '/', httpOnly: true, secure: !dev, sameSite: 'lax' } as const;

export function getSessionToken(cookies: Cookies): string | null {
  return cookies.get(SESSION_COOKIE) ?? null;
}

export function setSessionCookie(cookies: Cookies, token: string, expiresAt: string): void {
  cookies.set(SESSION_COOKIE, token, { ...options, expires: new Date(expiresAt) });
}

export function clearSessionCookie(cookies: Cookies): void {
  cookies.delete(SESSION_COOKIE, options);
}
