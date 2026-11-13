import type { OAuthProvider } from '@cupidilla/contracts';
import { FacebookClient } from './facebook.client.js';
import { GoogleClient } from './google.client.js';
import type { ProviderClient } from './provider-client.js';
import { providerSettings, type ProviderSettings } from './provider-config.js';

/** Token de inyección de los clientes configurados. */
export const PROVIDER_CLIENTS = Symbol('PROVIDER_CLIENTS');

export type ProviderClients = ReadonlyMap<OAuthProvider, ProviderClient>;

const FACTORIES: Partial<Record<OAuthProvider, (settings: ProviderSettings) => ProviderClient>> = {
  google: (settings) => new GoogleClient(settings),
  facebook: (settings) => new FacebookClient(settings),
};

/** Un cliente por proveedor con credenciales completas (§10.1). Sin ellas, el proveedor no existe. */
export function createProviderClients(
  env: Parameters<typeof providerSettings>[0],
): ProviderClients {
  const clients = new Map<OAuthProvider, ProviderClient>();
  for (const [provider, settings] of Object.entries(providerSettings(env)) as [
    OAuthProvider,
    ProviderSettings,
  ][]) {
    const factory = FACTORIES[provider];
    if (factory) clients.set(provider, factory(settings));
  }
  return clients;
}
