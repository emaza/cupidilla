import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/env';

/**
 * Cookies del hito de correo (técnico de correo §9.1). Solo las ve SvelteKit; la API no.
 *
 * - `cupidilla_pending_email`: el correo escrito en el alta (o en la recuperación) y su propósito,
 *   para pintar «Revisa tu correo» y reenviar sin poner el correo en la URL. Se pone igual exista
 *   o no la cuenta. Manipularla solo permite reenviar a otra dirección, lo mismo que escribirla.
 * - `cupidilla_email_token`: el token del enlace, que sale de la URL con un 303 antes de pintar
 *   nada (no queda en el historial ni en un `Referer`). Vive en la ruta de su página.
 */
export const PENDING_EMAIL_COOKIE = 'cupidilla_pending_email';
export const EMAIL_TOKEN_COOKIE = 'cupidilla_email_token';

const HOUR_S = 60 * 60;
const base = { httpOnly: true, secure: !dev, sameSite: 'lax' } as const;
const pendingOptions = { ...base, path: '/' } as const;

export type PendingPurpose = 'signup' | 'reset';

export function setPendingEmail(cookies: Cookies, purpose: PendingPurpose, email: string): void {
  // `cookies.set` codifica el valor (encodeURIComponent) y `get` lo descodifica.
  cookies.set(PENDING_EMAIL_COOKIE, `${purpose}:${email}`, { ...pendingOptions, maxAge: HOUR_S });
}

/** El correo pendiente de ese propósito, o `null`. */
export function getPendingEmail(cookies: Cookies, purpose: PendingPurpose): string | null {
  const value = cookies.get(PENDING_EMAIL_COOKIE);
  const prefix = `${purpose}:`;
  if (!value?.startsWith(prefix)) return null;
  const email = value.slice(prefix.length);
  return email === '' ? null : email;
}

export function clearPendingEmail(cookies: Cookies): void {
  cookies.delete(PENDING_EMAIL_COOKIE, pendingOptions);
}

/** Páginas que reciben un enlace con token. */
export type TokenPage = '/verify-email' | '/reset-password';

const tokenOptions = (path: TokenPage) => ({ ...base, path }) as const;

export function setEmailToken(cookies: Cookies, path: TokenPage, token: string): void {
  cookies.set(EMAIL_TOKEN_COOKIE, token, { ...tokenOptions(path), maxAge: HOUR_S });
}

export function getEmailToken(cookies: Cookies): string | null {
  return cookies.get(EMAIL_TOKEN_COOKIE) ?? null;
}

export function clearEmailToken(cookies: Cookies, path: TokenPage): void {
  cookies.delete(EMAIL_TOKEN_COOKIE, tokenOptions(path));
}
