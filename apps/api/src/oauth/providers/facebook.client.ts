import { Logger } from '@nestjs/common';
import {
  AuthorizationResponseError,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  type Configuration,
} from 'openid-client';
import { createHmac } from 'node:crypto';
import { logGraphError, logProviderError } from '../oauth-log.js';
import { normalizeProviderEmail, openIdConfiguration } from './google.client.js';
import type { ProviderSettings } from './provider-config.js';
import {
  ProviderCancelledError,
  ProviderFailedError,
  type AuthorizationUrlInput,
  type ExchangeInput,
  type ProviderClient,
  type ProviderIdentity,
} from './provider-client.js';

/**
 * Facebook con el flujo manual estable de OAuth 2 y la Graph API (§2, §3.3), no con su OIDC
 * «en pruebas». PKCE S256 y canje por POST (R2). Un access token canjeado con nuestro código y
 * nuestro secreto es de nuestra app por construcción: no hace falta `debug_token`.
 */
export class FacebookClient implements ProviderClient {
  readonly provider = 'facebook' as const;
  private readonly logger = new Logger(FacebookClient.name);
  private readonly config: Configuration;

  constructor(private readonly settings: ProviderSettings) {
    this.config = openIdConfiguration(settings, { issParameterSupported: false });
  }

  authorizationUrl({ state, codeChallenge, reauthenticate }: AuthorizationUrlInput): URL {
    const parameters: Record<string, string> = {
      redirect_uri: this.settings.redirectUri,
      response_type: 'code',
      // `public_profile` va implícito; no se pide nada más (UX §3.1.2).
      scope: 'email',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    };
    if (reauthenticate) parameters.auth_type = 'reauthenticate';
    return buildAuthorizationUrl(this.config, parameters);
  }

  async exchange({ callbackQuery, state, codeVerifier }: ExchangeInput): Promise<ProviderIdentity> {
    const currentUrl = new URL(`${this.settings.redirectUri}?${callbackQuery}`);
    let accessToken: string;
    try {
      const tokens = await authorizationCodeGrant(this.config, currentUrl, {
        pkceCodeVerifier: codeVerifier,
        expectedState: state,
      });
      accessToken = tokens.access_token;
    } catch (error) {
      if (error instanceof AuthorizationResponseError && error.error === 'access_denied') {
        throw new ProviderCancelledError();
      }
      const stage =
        error instanceof AuthorizationResponseError ? 'authorization_response' : 'token';
      logProviderError(this.logger, this.provider, stage, error);
      throw new ProviderFailedError();
    }
    return this.me(accessToken);
  }

  /** GET /me con `appsecret_proof` = HMAC-SHA256 del access token con el secreto (§3.3). */
  private async me(accessToken: string): Promise<ProviderIdentity> {
    const url = new URL(this.settings.userInfoEndpoint ?? '');
    url.searchParams.set('fields', 'id,email');
    url.searchParams.set(
      'appsecret_proof',
      createHmac('sha256', this.settings.clientSecret).update(accessToken).digest('hex'),
    );
    let body: unknown;
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.settings.timeoutMs),
      });
      if (!response.ok) {
        logGraphError(this.logger, response.status);
        throw new ProviderFailedError();
      }
      body = await response.json();
    } catch (error) {
      if (error instanceof ProviderFailedError) throw error;
      logProviderError(this.logger, this.provider, 'graph', error);
      throw new ProviderFailedError();
    }
    const { id, email } = (body ?? {}) as { id?: unknown; email?: unknown };
    if (typeof id !== 'string' || id.length === 0 || id.length > 255) {
      logGraphError(this.logger, null);
      throw new ProviderFailedError();
    }
    const normalized = normalizeProviderEmail(email);
    // Meta solo da el correo principal confirmado, sin indicador: se acepta como verificado
    // cuando lo devuelve (decisión del CTO; riesgo R1).
    return { subject: id, email: normalized, emailVerified: normalized !== null };
  }
}
