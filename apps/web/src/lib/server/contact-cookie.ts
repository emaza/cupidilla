import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/env';

/**
 * `cupidilla_contact_sent` (contacto UX §1.1): el correo escrito y si se encoló el acuse, para
 * pintar /contact/sent sin datos en la URL. De un solo uso: la página la borra al servirse, y sin
 * ella vuelve a /contact. Solo la ve SvelteKit; manipularla solo cambia lo que se ve uno mismo.
 */
export const CONTACT_SENT_COOKIE = 'cupidilla_contact_sent';
export const CONTACT_SENT_PATH = '/contact/sent';

const options = {
  httpOnly: true,
  secure: !dev,
  sameSite: 'lax',
  path: CONTACT_SENT_PATH,
} as const;

export interface ContactSent {
  email: string;
  ack: boolean;
}

export function setContactSent(cookies: Cookies, { email, ack }: ContactSent): void {
  // `cookies.set` codifica el valor (encodeURIComponent) y `get` lo descodifica.
  cookies.set(CONTACT_SENT_COOKIE, `${ack ? '1' : '0'}:${email}`, { ...options, maxAge: 15 * 60 });
}

/** Lee y borra la cookie. `null` si no hay (recarga, «atrás», enlace compartido). */
export function takeContactSent(cookies: Cookies): ContactSent | null {
  const value = cookies.get(CONTACT_SENT_COOKIE);
  if (value === undefined) return null;
  cookies.delete(CONTACT_SENT_COOKIE, options);
  const match = /^([01]):(.+)$/.exec(value);
  if (!match) return null;
  return { ack: match[1] === '1', email: match[2] ?? '' };
}
