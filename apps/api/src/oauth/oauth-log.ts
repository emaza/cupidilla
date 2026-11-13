import type { Logger } from '@nestjs/common';
import type { OAuthProvider } from '@cupidilla/contracts';

/** Fase del intercambio con el proveedor en la que falló. */
export type ProviderStage = 'authorization_response' | 'token' | 'graph';

/** Nombres de error que se registran tal cual; cualquier otro se registra como `Error`. */
const KNOWN_NAMES = new Set([
  'ClientError',
  'ResponseBodyError',
  'AuthorizationResponseError',
  'WWWAuthenticateChallengeError',
  'OperationProcessingError',
  'UnsupportedOperationError',
  'TimeoutError',
  'AbortError',
  'TypeError',
]);

/** Solo códigos con forma de código (`OAUTH_JWT_CLAIM_COMPARISON_FAILED`, `invalid_grant`). */
const CODE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

const safeCode = (value: unknown): string | null =>
  typeof value === 'string' && CODE_PATTERN.test(value) ? value : null;

/**
 * Describe un error de openid-client o de `fetch` sin datos sensibles (§12.6). Esos errores
 * llevan en `message` y `cause` el cuerpo de la respuesta, con tokens: nunca se registran
 * `message`, `stack` ni `cause`.
 */
export function describeProviderError(error: unknown): {
  name: string;
  code: string | null;
  oauthError: string | null;
} {
  if (!(error instanceof Error)) return { name: typeof error, code: null, oauthError: null };
  const { code, error: oauthError } = error as { code?: unknown; error?: unknown };
  return {
    name: KNOWN_NAMES.has(error.name) ? error.name : 'Error',
    code: safeCode(code),
    oauthError: safeCode(oauthError),
  };
}

export function logProviderError(
  logger: Logger,
  provider: OAuthProvider,
  stage: ProviderStage,
  error: unknown,
): void {
  logger.warn({ event: 'oauth_provider_error', provider, stage, ...describeProviderError(error) });
}

/** Fallo de la Graph API: solo el estado HTTP. */
export function logGraphError(logger: Logger, status: number | null): void {
  logger.warn({ event: 'oauth_provider_error', provider: 'facebook', stage: 'graph', status });
}
