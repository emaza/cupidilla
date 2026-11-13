import type { OAuthProvider } from '@cupidilla/contracts';

/** Lo único que Cupidilla toma del proveedor (§5.2). Nunca nombre, foto ni tokens. */
export interface ProviderIdentity {
  subject: string;
  /** Ya normalizado con `emailSchema`; `null` si falta o no es un correo válido. */
  email: string | null;
  emailVerified: boolean;
}

export interface AuthorizationUrlInput {
  state: string;
  codeChallenge: string;
  nonce: string;
  /** Reautenticación (§9.1): Google pide elegir cuenta; Facebook, volver a entrar. */
  reauthenticate: boolean;
  loginHint?: string;
}

export interface ExchangeInput {
  /** La consulta de la vuelta, tal cual y sin `?`. */
  callbackQuery: string;
  state: string;
  codeVerifier: string;
  nonce: string;
}

export interface ProviderClient {
  readonly provider: OAuthProvider;
  authorizationUrl(input: AuthorizationUrlInput): URL;
  /** Lanza `ProviderCancelledError` o `ProviderFailedError`; nunca devuelve tokens. */
  exchange(input: ExchangeInput): Promise<ProviderIdentity>;
}

/** La persona canceló en el proveedor (`error=access_denied`). */
export class ProviderCancelledError extends Error {
  constructor() {
    super('Cancelled at the provider');
    this.name = 'ProviderCancelledError';
  }
}

/**
 * El proveedor falló, respondió algo inválido o no respondió a tiempo. No lleva `cause`: el
 * error original de openid-client puede llevar tokens en su cuerpo (§12.6). Ya se registró
 * saneado al crearlo.
 */
export class ProviderFailedError extends Error {
  constructor() {
    super('Provider failed');
    this.name = 'ProviderFailedError';
  }
}
