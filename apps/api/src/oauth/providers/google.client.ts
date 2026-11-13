import { Logger } from '@nestjs/common';
import { emailSchema } from '@cupidilla/contracts';
import {
  allowInsecureRequests,
  AuthorizationResponseError,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  ClientSecretPost,
  Configuration,
  customFetch,
} from 'openid-client';
import { logProviderError } from '../oauth-log.js';
import type { ProviderSettings } from './provider-config.js';
import {
  ProviderCancelledError,
  ProviderFailedError,
  type AuthorizationUrlInput,
  type ExchangeInput,
  type ProviderClient,
  type ProviderIdentity,
} from './provider-client.js';

/** Configuración de openid-client común a los dos proveedores: metadatos estáticos y timeout. */
export function openIdConfiguration(
  settings: ProviderSettings,
  options: { issParameterSupported: boolean },
): Configuration {
  const config = new Configuration(
    {
      issuer: settings.issuer,
      authorization_endpoint: settings.authorizationEndpoint,
      token_endpoint: settings.tokenEndpoint,
      // Google lo declara en su discovery: openid-client exige entonces el `iss` de la vuelta
      // (RFC 9207). Facebook no lo envía.
      authorization_response_iss_parameter_supported: options.issParameterSupported,
    },
    settings.clientId,
    undefined,
    ClientSecretPost(settings.clientSecret),
  );
  // Solo con el proveedor falso (el envSchema lo prohíbe en producción).
  if (settings.allowInsecureRequests) allowInsecureRequests(config);
  config[customFetch] = (url, init) =>
    fetch(url, { ...init, signal: AbortSignal.timeout(settings.timeoutMs) });
  return config;
}

/** Correo normalizado como `users.email`, o `null` si falta o no es válido. */
export function normalizeProviderEmail(value: unknown): string | null {
  const parsed = emailSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Google con OpenID Connect: el `id_token` llega por TLS del token endpoint (§2). */
export class GoogleClient implements ProviderClient {
  readonly provider = 'google' as const;
  private readonly logger = new Logger(GoogleClient.name);
  private readonly config: Configuration;

  constructor(private readonly settings: ProviderSettings) {
    this.config = openIdConfiguration(settings, { issParameterSupported: true });
  }

  authorizationUrl({
    state,
    codeChallenge,
    nonce,
    reauthenticate,
    loginHint,
  }: AuthorizationUrlInput): URL {
    const parameters: Record<string, string> = {
      redirect_uri: this.settings.redirectUri,
      response_type: 'code',
      scope: 'openid email',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      // Siempre la pantalla de elegir cuenta: salir de Cupidilla no cierra la sesión de Google,
      // y sin esto Google entraría con la cuenta que tenga abierta el navegador sin preguntar.
      prompt: 'select_account',
    };
    if (reauthenticate && loginHint) parameters.login_hint = loginHint;
    return buildAuthorizationUrl(this.config, parameters);
  }

  async exchange({
    callbackQuery,
    state,
    codeVerifier,
    nonce,
  }: ExchangeInput): Promise<ProviderIdentity> {
    const currentUrl = new URL(`${this.settings.redirectUri}?${callbackQuery}`);
    let claims: Record<string, unknown> | undefined;
    try {
      const tokens = await authorizationCodeGrant(this.config, currentUrl, {
        pkceCodeVerifier: codeVerifier,
        expectedState: state,
        expectedNonce: nonce,
        idTokenExpected: true,
      });
      claims = tokens.claims();
    } catch (error) {
      if (error instanceof AuthorizationResponseError && error.error === 'access_denied') {
        throw new ProviderCancelledError();
      }
      const stage =
        error instanceof AuthorizationResponseError ? 'authorization_response' : 'token';
      logProviderError(this.logger, this.provider, stage, error);
      throw new ProviderFailedError();
    }
    const subject = claims?.sub;
    if (typeof subject !== 'string' || subject.length === 0 || subject.length > 255) {
      logProviderError(this.logger, this.provider, 'token', new Error('invalid sub'));
      throw new ProviderFailedError();
    }
    return {
      subject,
      email: normalizeProviderEmail(claims?.email),
      emailVerified: claims?.email_verified === true,
    };
  }
}
