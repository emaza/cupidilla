import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/env';

/**
 * Cookie del flujo con un proveedor (técnico §4): primero lleva el `flowToken` y, tras la vuelta,
 * el `pendingToken` del alta o la unión. `Lax`: la vuelta del proveedor es una navegación GET de
 * nivel superior y `Lax` la envía.
 */
export const OAUTH_COOKIE = 'cupidilla_oauth';

const options = { path: '/', httpOnly: true, secure: !dev, sameSite: 'lax' } as const;

export function getOAuthToken(cookies: Cookies): string | null {
  return cookies.get(OAUTH_COOKIE) ?? null;
}

export function setOAuthToken(cookies: Cookies, token: string, expiresAt: string): void {
  cookies.set(OAUTH_COOKIE, token, { ...options, expires: new Date(expiresAt) });
}

export function clearOAuthToken(cookies: Cookies): void {
  cookies.delete(OAUTH_COOKIE, options);
}
