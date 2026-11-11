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

interface RequestOptions<T> {
  method: 'GET' | 'POST';
  path: string;
  token?: string;
  body?: unknown;
  /** Esquema de la respuesta correcta. Sin esquema, la respuesta no tiene cuerpo (204). */
  schema?: z.ZodType<T>;
}

/**
 * Única puerta a la API. Añade la clave interna, la IP del cliente y, si hay sesión, el token.
 * Nunca registra nada de la petición ni de la respuesta (§8.9).
 */
async function request<T>(
  event: RequestEvent,
  { method, path, token, body, schema }: RequestOptions<T>,
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
  } catch {
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
  return parsed.success
    ? { ok: true, status: response.status, data: parsed.data }
    : unavailable(502);
}

export const api = {
  register: (event: RequestEvent, body: RegisterRequest): Promise<ApiResult<AuthResponse>> =>
    request(event, { method: 'POST', path: '/auth/register', body, schema: authResponseSchema }),

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
    request(event, { method: 'POST', path: '/users/me/deletion', token, body }),
};
