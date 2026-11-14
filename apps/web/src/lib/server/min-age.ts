import { DEFAULT_MIN_AGE, type ConfigResponse } from '@cupidilla/contracts';
import type { RequestEvent } from '@sveltejs/kit';
import { api } from '#lib/server/api-client.ts';

/** Cuánto vale en memoria la edad mínima leída de la API. */
export const MIN_AGE_TTL_MS = 60_000;
/** Tras un fallo, los textos de las páginas no vuelven a preguntar a la API durante este tiempo. */
export const MIN_AGE_RETRY_MS = 5_000;

let cached: { value: number; mail: ConfigResponse['mail'] | null; at: number } | null = null;
let failedAt: number | null = null;
let inFlight: Promise<number | null> | null = null;

/** Solo para los tests. */
export function resetMinAgeCache(): void {
  cached = null;
  failedAt = null;
  inFlight = null;
}

async function refresh(event: RequestEvent): Promise<number | null> {
  const result = await api.config(event);
  const now = Date.now();
  if (result.ok) {
    // `mail` puede faltar si la API es anterior al hito de correo: entonces no se sabe.
    cached = { value: result.data.minAge, mail: result.data.mail ?? null, at: now };
    failedAt = null;
    return result.data.minAge;
  }
  failedAt = now;
  return null;
}

/**
 * Edad mínima vigente según la API, o `null` si no se puede saber ahora (la API no responde y no
 * hay un valor fresco). Para validar formularios: con `null`, la página se comporta como con la API
 * caída. La API sigue siendo la autoridad.
 */
export async function currentMinAge(
  event: RequestEvent,
  { respectBackoff = false }: { respectBackoff?: boolean } = {},
): Promise<number | null> {
  const now = Date.now();
  if (cached && now - cached.at < MIN_AGE_TTL_MS) return cached.value;
  // Solo los textos esperan tras un fallo (no retrasar cada página): validar siempre lo intenta.
  if (respectBackoff && failedAt !== null && now - failedAt < MIN_AGE_RETRY_MS) return null;
  inFlight ??= refresh(event).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * Edad mínima para los textos: la vigente, o el último valor conocido, o `DEFAULT_MIN_AGE` si
 * nunca se obtuvo. No lanza nunca.
 */
export async function displayMinAge(event: RequestEvent): Promise<number> {
  const fresh = await currentMinAge(event, { respectBackoff: true }).catch(() => null);
  return fresh ?? cached?.value ?? DEFAULT_MIN_AGE;
}

/**
 * Correos opcionales de la instalación (correo §5.8, UX §6.9), de la misma caché de `GET /config`.
 * Si no se sabe (la API no responde y nunca respondió), los dos falsos: ningún texto promete un
 * correo que quizá no existe.
 */
export async function displayMailConfig(event: RequestEvent): Promise<ConfigResponse['mail']> {
  await currentMinAge(event, { respectBackoff: true }).catch(() => null);
  return cached?.mail ?? { unverifiedReminder: false, passwordChangedNotice: false };
}
