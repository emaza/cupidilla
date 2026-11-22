import { redirect } from '@sveltejs/kit';
import { takeContactSent } from '#lib/server/contact-cookie.ts';
import type { PageServerLoad } from './$types';

/**
 * «Mensaje enviado» (contacto UX §2.2). El correo y el acuse salen de la cookie de un solo uso,
 * nunca de la URL; sin ella (recarga, «atrás», enlace compartido), de vuelta a /contact sin mensaje.
 */
export const load: PageServerLoad = ({ cookies }) => {
  const sent = takeContactSent(cookies);
  if (!sent) redirect(303, '/contact');
  return sent;
};
