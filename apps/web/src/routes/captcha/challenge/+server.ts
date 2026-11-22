import { json } from '@sveltejs/kit';
import { api } from '#lib/server/api-client.ts';
import type { RequestHandler } from './$types';

/**
 * Reto antibots para el widget (técnico de captcha §6.4). Solo intermediario: la API lo crea y
 * aquí solo se valida su forma con `captchaChallengeSchema`. Nunca se registra nada del reto.
 */
export const GET: RequestHandler = async (event) => {
  const result = await api.captchaChallenge(event);
  const headers = { 'Cache-Control': 'no-store' };
  if (result.ok) return json(result.data, { headers });
  // El widget solo enseña su estado de error: el cuerpo no se muestra.
  return json({ error: result.error.code }, { status: result.status === 404 ? 404 : 503, headers });
};
