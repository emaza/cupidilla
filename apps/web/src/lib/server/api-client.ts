import {
  accountResponseSchema,
  apiErrorSchema,
  authResponseSchema,
  oauthAuthResponseSchema,
  oauthCallbackResponseSchema,
  oauthProvidersResponseSchema,
  oauthStartResponseSchema,
  pendingIdentityResponseSchema,
  sessionResponseSchema,
  type AccountResponse,
  type AuthResponse,
  type DeleteAccountRequest,
  type FieldError,
  type LoginRequest,
  type OAuthAuthResponse,
  type OAuthCallbackRequest,
  type OAuthCallbackResponse,
  type OAuthLinkRequest,
  type OAuthProvider,
  type OAuthProvidersResponse,
  type OAuthSessionStartRequest,
  type OAuthSignupRequest,
  type OAuthStartRequest,
  type OAuthStartResponse,
  type PendingIdentityResponse,
  type ReauthenticateRequest,
  type RegisterRequest,
  type RemoveIdentityRequest,
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
  /**
   * Estado 2xx exacto que confirma la operación (p. ej. 204 en el borrado). Cualquier otro 2xx,
   * que podría venir de un intermediario, no se toma como éxito: `OUTCOME_UNKNOWN` si la
   * petición es `nonIdempotent`, `API_UNAVAILABLE` (502) si no.
   */
  expectStatus?: number;
  /** Tiempo máximo de la petición. Por defecto, 5 s. */
  timeoutMs?: number;
  /** Cabeceras propias de la ruta (p. ej. el token pendiente de OAuth). */
  headers?: Record<string, string>;
}

/**
 * La vuelta del proveedor hace hasta dos peticiones al proveedor (2 × OAUTH_HTTP_TIMEOUT_MS,
 * como mucho 8 s) más la base de datos (técnico §11.1).
 */
export const OAUTH_CALLBACK_TIMEOUT_MS = 12_000;

/**
 * Única puerta a la API. Añade la clave interna, la IP del cliente y, si hay sesión, el token.
 * Nunca registra nada de la petición ni de la respuesta (§8.9).
 */
async function request<T>(
  event: RequestEvent,
  {
    method,
    path,
    token,
    body,
    schema,
    nonIdempotent = false,
    expectStatus,
    timeoutMs = TIMEOUT_MS,
    headers: extraHeaders,
  }: RequestOptions<T>,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {
    ...extraHeaders,
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
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // Tiempo agotado (TimeoutError) o conexión cortada tras enviar (ECONNRESET, UND_ERR_SOCKET…).
    if (nonIdempotent && !failedBeforeSending(error)) return outcomeUnknown();
    return unavailable();
  }

  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    if (!parsed.success) {
      // Un 5xx sin el cuerpo de error de la API (p. ej. un 502 o un 504 de un proxy) puede llegar
      // después de que la escritura se haya hecho: en una no idempotente, resultado incierto.
      if (response.status >= 500 && nonIdempotent) return outcomeUnknown();
      return unavailable(response.status >= 500 ? response.status : 502);
    }
    return {
      ok: false,
      status: response.status,
      error: { code: parsed.data.error.code, fields: parsed.data.error.fields },
    };
  }

  if (expectStatus !== undefined && response.status !== expectStatus) {
    return nonIdempotent ? outcomeUnknown() : unavailable(502);
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
      expectStatus: 204, // users.controller.ts: @HttpCode(204)
    }),

  // Entrada con Google y Facebook (técnico §11.1).

  oauthProviders: (event: RequestEvent): Promise<ApiResult<OAuthProvidersResponse>> =>
    request(event, {
      method: 'GET',
      path: '/auth/oauth/providers',
      schema: oauthProvidersResponseSchema,
    }),

  oauthStart: (
    event: RequestEvent,
    provider: OAuthProvider,
    body: OAuthStartRequest,
  ): Promise<ApiResult<OAuthStartResponse>> =>
    request(event, {
      method: 'POST',
      path: `/auth/oauth/${provider}/authorization`,
      body,
      schema: oauthStartResponseSchema,
    }),

  oauthCallback: (
    event: RequestEvent,
    provider: OAuthProvider,
    body: OAuthCallbackRequest,
    sessionToken?: string,
  ): Promise<ApiResult<OAuthCallbackResponse>> =>
    request(event, {
      method: 'POST',
      path: `/auth/oauth/${provider}/callback`,
      token: sessionToken,
      body,
      schema: oauthCallbackResponseSchema,
      timeoutMs: OAUTH_CALLBACK_TIMEOUT_MS,
    }),

  oauthPending: (
    event: RequestEvent,
    pendingToken: string,
  ): Promise<ApiResult<PendingIdentityResponse>> =>
    request(event, {
      method: 'GET',
      path: '/auth/oauth/pending',
      headers: { 'X-Oauth-Pending-Token': pendingToken },
      schema: pendingIdentityResponseSchema,
    }),

  oauthCancelPending: (event: RequestEvent, pendingToken: string): Promise<ApiResult<void>> =>
    request(event, {
      method: 'POST',
      path: '/auth/oauth/pending/cancellation',
      body: { pendingToken },
      expectStatus: 204,
    }),

  oauthSignup: (
    event: RequestEvent,
    body: OAuthSignupRequest,
  ): Promise<ApiResult<OAuthAuthResponse>> =>
    request(event, {
      method: 'POST',
      path: '/auth/oauth/signup',
      body,
      schema: oauthAuthResponseSchema,
      nonIdempotent: true,
    }),

  oauthLink: (event: RequestEvent, body: OAuthLinkRequest): Promise<ApiResult<OAuthAuthResponse>> =>
    request(event, {
      method: 'POST',
      path: '/auth/oauth/link',
      body,
      schema: oauthAuthResponseSchema,
      nonIdempotent: true,
    }),

  oauthSessionStart: (
    event: RequestEvent,
    token: string,
    provider: OAuthProvider,
    body: OAuthSessionStartRequest,
  ): Promise<ApiResult<OAuthStartResponse>> =>
    request(event, {
      method: 'POST',
      path: `/users/me/oauth/${provider}/authorization`,
      token,
      body,
      schema: oauthStartResponseSchema,
    }),

  reauthenticate: (
    event: RequestEvent,
    token: string,
    body: ReauthenticateRequest,
  ): Promise<ApiResult<void>> =>
    request(event, {
      method: 'POST',
      path: '/users/me/reauthentication',
      token,
      body,
      expectStatus: 204,
    }),

  removeIdentity: (
    event: RequestEvent,
    token: string,
    provider: OAuthProvider,
    body: RemoveIdentityRequest,
  ): Promise<ApiResult<void>> =>
    request(event, {
      method: 'POST',
      path: `/users/me/identities/${provider}/removal`,
      token,
      body,
      expectStatus: 204,
    }),
};

/**
 * Proveedores con credenciales en la API. Si la API no responde, ninguno: la página sigue
 * funcionando con correo y contraseña (UX §3.1.3).
 */
export async function configuredProviders(event: RequestEvent): Promise<OAuthProvider[]> {
  const result = await api.oauthProviders(event);
  return result.ok ? result.data.providers : [];
}
