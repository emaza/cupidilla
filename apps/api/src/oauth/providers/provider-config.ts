import type { OAuthProvider } from '@cupidilla/contracts';
import type { Env } from '../../config/env.schema.js';

/** Versión de la Graph API. Caducan en unos dos años: revisarla cada año (R8). */
export const FACEBOOK_GRAPH_VERSION = 'v27.0';

/** Endpoints y credenciales de un proveedor. Metadatos estáticos: sin `discovery` (§3.3). */
export interface ProviderSettings {
  provider: OAuthProvider;
  clientId: string;
  clientSecret: string;
  /** La misma cadena en la autorización y en el canje (§12.1). */
  redirectUri: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** Solo Facebook: `GET /me` de la Graph API. */
  userInfoEndpoint?: string;
  /** Solo con el proveedor falso: permite `http:` en las peticiones al proveedor. */
  allowInsecureRequests: boolean;
  timeoutMs: number;
}

/** `redirect_uri` de un proveedor. Se construye solo aquí (§12.1). */
export const redirectUriFor = (baseUrl: string, provider: OAuthProvider): string =>
  `${baseUrl}/auth/${provider}/callback`;

type OAuthEnv = Pick<
  Env,
  | 'PUBLIC_WEB_URL'
  | 'GOOGLE_CLIENT_ID'
  | 'GOOGLE_CLIENT_SECRET'
  | 'FACEBOOK_APP_ID'
  | 'FACEBOOK_APP_SECRET'
  | 'OAUTH_HTTP_TIMEOUT_MS'
  | 'OAUTH_FAKE_PROVIDER_URL'
>;

/**
 * Proveedores configurados, con sus endpoints reales o los del proveedor falso. Un proveedor
 * solo aparece si su pareja de credenciales está completa. La redirect URI se construye con
 * `PUBLIC_WEB_URL` (obligatoria en el `envSchema`).
 */
export function providerSettings(env: OAuthEnv): Partial<Record<OAuthProvider, ProviderSettings>> {
  const base = env.PUBLIC_WEB_URL;
  const fake = env.OAUTH_FAKE_PROVIDER_URL?.replace(/\/$/, '');
  const common = {
    allowInsecureRequests: fake !== undefined,
    timeoutMs: env.OAUTH_HTTP_TIMEOUT_MS,
  };
  const result: Partial<Record<OAuthProvider, ProviderSettings>> = {};

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    result.google = {
      ...common,
      provider: 'google',
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: redirectUriFor(base, 'google'),
      ...(fake
        ? {
            issuer: `${fake}/google`,
            authorizationEndpoint: `${fake}/google/authorize`,
            tokenEndpoint: `${fake}/google/token`,
          }
        : {
            issuer: 'https://accounts.google.com',
            authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
            tokenEndpoint: 'https://oauth2.googleapis.com/token',
          }),
    };
  }

  if (env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET) {
    result.facebook = {
      ...common,
      provider: 'facebook',
      clientId: env.FACEBOOK_APP_ID,
      clientSecret: env.FACEBOOK_APP_SECRET,
      redirectUri: redirectUriFor(base, 'facebook'),
      ...(fake
        ? {
            issuer: `${fake}/facebook`,
            authorizationEndpoint: `${fake}/facebook/dialog/oauth`,
            tokenEndpoint: `${fake}/facebook/oauth/access_token`,
            userInfoEndpoint: `${fake}/facebook/me`,
          }
        : {
            issuer: 'https://www.facebook.com',
            authorizationEndpoint: `https://www.facebook.com/${FACEBOOK_GRAPH_VERSION}/dialog/oauth`,
            tokenEndpoint: `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/oauth/access_token`,
            userInfoEndpoint: `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/me`,
          }),
    };
  }
  return result;
}
