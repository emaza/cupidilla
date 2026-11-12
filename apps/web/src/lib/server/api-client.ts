import {
  accountResponseSchema,
  apiErrorSchema,
  authResponseSchema,
  sessionResponseSchema,
  type AccountResponse,
  type AuthResponse,
  type DeleteAccountRequest,
  type FieldError,
  type LoginRequest,
  type RegisterRequest,
  type SessionResponse,
} from '@cupidilla/contracts';
import type { RequestEvent } from '@sveltejs/kit';
import type { z } from 'zod';
import { API_URL, INTERNAL_API_KEY } from '$app/env/private';
import type { WebErrorCode } from '#lib/errors/messages.ts';

const TIMEOUT_MS = 5000;

export interface WebApiError {
  code: WebErrorCode;
  fields?: FieldError[];
}

export type ApiResult<T> =
  { ok: true; status: number; data: T } | { ok: false; status: number; error: WebApiError };

const unavailable = (status = 503): ApiResult<never> => ({
  ok: false,
  status,
  error: { code: 'API_UNAVAILABLE' },
});

const outcomeUnknown = (): ApiResult<never> => ({
  ok: false,
  status: 503,
  error: { code: 'OUTCOME_UNKNOWN' },
});

/**
 * Códigos de error de conexión (en `error.cause.code` de `fetch`) que indican que la petición no
 * llegó a salir: la API no ha hecho nada.
 */
const NOT_SENT_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EADDRNOTAVAIL',
  'UND_ERR_CONNECT_TIMEOUT',
]);

function errorCode(value: unknown): unknown {
  return typeof value === 'object' && value !== null
    ? (value as { code?: unknown }).code
    : undefined;
}

/** ¿Falló `fetch` antes de enviar la petición? Con varias direcciones, la causa es un `AggregateError`. */
export function failedBeforeSending(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  const codes = [cause, ...(cause instanceof AggregateError ? cause.errors : [])].map(errorCode);
  return codes.some((code) => typeof code === 'string' && NOT_SENT_CODES.has(code));
}

interface RequestOptions<T> {
  method: 'GET' | 'POST';
  path: string;
  token?: string;
  body?: unknown;
  /** Esquema de la respuesta correcta. Sin esquema, la respuesta no tiene cuerpo (204). */
  schema?: z.ZodType<T>;
  /**
   * Escritura no idempotente (registro, borrado). Si la petición se envió y no hubo respuesta
   * (tiempo agotado, conexión cortada o cualquier fallo que no sea de conexión), el resultado es
   * `OUTCOME_UNKNOWN` y no `API_UNAVAILABLE`: no sabemos si la API la llegó a hacer. Nunca se
   * reintenta.
   */
  nonIdempotent?: boolean;
}

/**
 * Única puerta a la API. Añade la clave interna, la IP del cliente y, si hay sesión, el token.
 * Nunca registra nada de la petición ni de la respuesta (§8.9).
 */
async function request<T>(
  event: RequestEvent,
  { method, path, token, body, schema, nonIdempotent = false }: RequestOptions<T>,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Internal-Api-Key': INTERNAL_API_KEY,
    'X-Client-Ip': event.getClientAddress(),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(new URL(path, API_URL), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // Tiempo agotado (TimeoutError) o conexión cortada tras enviar (ECONNRESET, UND_ERR_SOCKET…).
    if (nonIdempotent && !failedBeforeSending(error)) return outcomeUnknown();
    return unavailable();
  }

  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    if (!parsed.success) return unavailable(response.status >= 500 ? response.status : 502);
    return {
      ok: false,
      status: response.status,
      error: { code: parsed.data.error.code, fields: parsed.data.error.fields },
    };
  }

  if (!schema) return { ok: true, status: response.status, data: undefined as T };
  const parsed = schema.safeParse(payload);
  if (parsed.success) return { ok: true, status: response.status, data: parsed.data };
  // Un 2xx confirma que la API hizo la operación, pero sin un cuerpo válido (cortado a mitad o
  // fuera del esquema) no se puede usar: en una escritura no idempotente, resultado incierto.
  return nonIdempotent ? outcomeUnknown() : unavailable(502);
}

export const api = {
  register: (event: RequestEvent, body: RegisterRequest): Promise<ApiResult<AuthResponse>> =>
    request(event, {
      method: 'POST',
      path: '/auth/register',
      body,
      schema: authResponseSchema,
      nonIdempotent: true,
    }),

  login: (event: RequestEvent, body: LoginRequest): Promise<ApiResult<AuthResponse>> =>
    request(event, { method: 'POST', path: '/auth/login', body, schema: authResponseSchema }),

  logout: (event: RequestEvent, token: string): Promise<ApiResult<void>> =>
    request(event, { method: 'POST', path: '/auth/logout', token }),

  session: (event: RequestEvent, token: string): Promise<ApiResult<SessionResponse>> =>
    request(event, { method: 'GET', path: '/auth/session', token, schema: sessionResponseSchema }),

  account: (event: RequestEvent, token: string): Promise<ApiResult<AccountResponse>> =>
    request(event, { method: 'GET', path: '/users/me', token, schema: accountResponseSchema }),

  deleteAccount: (
    event: RequestEvent,
    token: string,
    body: DeleteAccountRequest,
  ): Promise<ApiResult<void>> =>
    request(event, {
      method: 'POST',
      path: '/users/me/deletion',
      token,
      body,
      nonIdempotent: true,
    }),
};
