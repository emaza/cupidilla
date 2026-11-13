import type { OAuthCallbackResponse, OAuthFailureReason } from '@cupidilla/contracts';
import type { ApiResult } from './api-client.ts';
import { safeReturnPath } from './return-path.ts';

/** Qué hace la web con la respuesta de la vuelta (técnico §11.2 y §11.3). */
export type CallbackOutcome =
  | { kind: 'session'; location: string; session: { token: string; expiresAt: string } }
  | { kind: 'pending'; location: string; pending: { token: string; expiresAt: string } }
  | { kind: 'redirect'; location: string };

const FAILURE_VALUES: Record<OAuthFailureReason, { notice?: string; error?: string }> = {
  cancelled: { notice: 'provider-cancelled' },
  provider_failed: { error: 'provider-failed' },
  email_missing: { error: 'email-missing' },
  email_unverified: { error: 'email-unverified' },
  identity_mismatch: { error: 'identity-mismatch' },
  identity_in_use: { error: 'identity-in-use' },
  already_linked: { error: 'already-linked' },
};

/** Ruta con un aviso o un error de la lista cerrada y el proveedor. */
const withMessage = (
  path: string,
  message: { notice?: string; error?: string },
  provider: string,
): string => {
  const params = new URLSearchParams();
  if (message.error) params.set('error', message.error);
  else if (message.notice) params.set('notice', message.notice);
  params.set('provider', provider);
  return `${path}?${params.toString()}`;
};

/**
 * Redirección de la vuelta. La cookie `cupidilla_oauth` solo sigue viva, con el token pendiente,
 * en el alta y la unión; en todo lo demás se borra.
 */
export function callbackOutcome(
  provider: string,
  result: ApiResult<OAuthCallbackResponse>,
): CallbackOutcome {
  if (!result.ok) {
    // Flujo caducado, ya usado o con una cookie que no vale: «ha pasado demasiado tiempo».
    if (result.error.code === 'OAUTH_FLOW_INVALID' || result.error.code === 'VALIDATION_FAILED') {
      return { kind: 'redirect', location: '/login?error=provider-expired' };
    }
    if (result.error.code === 'RATE_LIMITED') {
      return { kind: 'redirect', location: '/login?error=rate-limited' };
    }
    // El texto lleva el nombre del proveedor: sin `provider` no se mostraría.
    return {
      kind: 'redirect',
      location: withMessage('/login', { error: 'provider-failed' }, provider),
    };
  }

  const data = result.data;
  switch (data.result) {
    case 'signed_in':
      return { kind: 'session', location: safeReturnPath(data.returnPath), session: data.session };
    case 'signup_required':
      return { kind: 'pending', location: '/register/complete', pending: data.pending };
    case 'link_required':
      return { kind: 'pending', location: '/login/link', pending: data.pending };
    case 'use_other_provider':
      return {
        kind: 'redirect',
        location: withMessage('/login', { error: 'other-provider' }, data.providers[0] ?? provider),
      };
    case 'reauthenticated':
      return {
        kind: 'redirect',
        location: `${safeReturnPath(data.returnPath)}?notice=reauthenticated`,
      };
    case 'connected':
      return {
        kind: 'redirect',
        location: withMessage('/account', { notice: 'linked' }, provider),
      };
    case 'failed': {
      const page =
        data.entryPoint === 'account' ? safeReturnPath(data.returnPath) : `/${data.entryPoint}`;
      return {
        kind: 'redirect',
        location: withMessage(page, FAILURE_VALUES[data.reason], provider),
      };
    }
  }
}
