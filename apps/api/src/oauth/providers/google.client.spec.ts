import { Logger } from '@nestjs/common';
import {
  completeFakeAuthorization,
  startFakeOAuthProvider,
  type FakeProvider,
  type FakeScenario,
} from '@cupidilla/fake-oauth-provider';
import { calculatePKCECodeChallenge, randomPKCECodeVerifier } from 'openid-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GoogleClient } from './google.client.js';
import { ProviderCancelledError, ProviderFailedError } from './provider-client.js';
import { providerSettings } from './provider-config.js';

const BASE = 'http://localhost:5173';
const TIMEOUT_MS = 600;

let provider: FakeProvider;
let client: GoogleClient;

beforeAll(async () => {
  provider = await startFakeOAuthProvider({
    google: {
      clientId: 'google-cliente',
      clientSecret: 'google-secreto',
      redirectUris: [`${BASE}/auth/google/callback`],
    },
    facebook: { appId: '1', appSecret: 'x', redirectUris: [] },
    slowResponseMs: TIMEOUT_MS + 400,
  });
  const settings = providerSettings({
    PUBLIC_WEB_URL: BASE,
    GOOGLE_CLIENT_ID: 'google-cliente',
    GOOGLE_CLIENT_SECRET: 'google-secreto',
    FACEBOOK_APP_ID: undefined,
    FACEBOOK_APP_SECRET: undefined,
    OAUTH_HTTP_TIMEOUT_MS: TIMEOUT_MS,
    OAUTH_FAKE_PROVIDER_URL: provider.url,
  }).google;
  if (!settings) throw new Error('Google sin configurar');
  client = new GoogleClient(settings);
});
afterAll(async () => {
  await provider.close();
});

/** Recorre el flujo entero contra el proveedor falso y devuelve lo que da `exchange`. */
async function flow(
  identity: { email?: string; emailVerified?: boolean; scenario?: FakeScenario } = {},
  options: { decision?: 'approve' | 'deny'; tamperState?: boolean } = {},
) {
  const codeVerifier = randomPKCECodeVerifier();
  const state = 'estado-123';
  const nonce = 'nonce-456';
  const url = client.authorizationUrl({
    state,
    nonce,
    codeChallenge: await calculatePKCECodeChallenge(codeVerifier),
    reauthenticate: false,
  });
  const callback = await completeFakeAuthorization(url.toString(), {
    subject: 'sub-123',
    email: 'Persona@Example.com',
    ...identity,
    decision: options.decision,
  });
  return client.exchange({
    callbackQuery: callback.search.slice(1),
    state: options.tamperState ? 'otro-estado' : state,
    codeVerifier,
    nonce,
  });
}

describe('GoogleClient con el proveedor falso', () => {
  it('la URL lleva response_type, scope, S256, state, nonce y la redirect_uri exacta', () => {
    const url = client.authorizationUrl({
      state: 's',
      nonce: 'n',
      codeChallenge: 'c',
      reauthenticate: false,
    });
    expect(url.origin + url.pathname).toBe(`${provider.url}/google/authorize`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'google-cliente',
      redirect_uri: `${BASE}/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email',
      state: 's',
      nonce: 'n',
      code_challenge: 'c',
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
  });

  it('con reautenticación añade login_hint (prompt=select_account va siempre)', () => {
    const url = client.authorizationUrl({
      state: 's',
      nonce: 'n',
      codeChallenge: 'c',
      reauthenticate: true,
      loginHint: 'persona@example.com',
    });
    expect(url.searchParams.get('prompt')).toBe('select_account');
    expect(url.searchParams.get('login_hint')).toBe('persona@example.com');
  });

  it('openid-client acepta el id_token del falso: identidad con el correo normalizado', async () => {
    await expect(flow()).resolves.toEqual({
      subject: 'sub-123',
      email: 'persona@example.com',
      emailVerified: true,
    });
  });

  it('correo sin verificar y sin correo', async () => {
    await expect(flow({ emailVerified: false })).resolves.toMatchObject({
      emailVerified: false,
    });
    await expect(flow({ email: '' })).resolves.toMatchObject({ email: null });
  });

  it('cancelar en el proveedor → ProviderCancelledError', async () => {
    await expect(flow({}, { decision: 'deny' })).rejects.toBeInstanceOf(ProviderCancelledError);
  });

  it('un state distinto → ProviderFailedError', async () => {
    await expect(flow({}, { tamperState: true })).rejects.toBeInstanceOf(ProviderFailedError);
  });

  it.each<FakeScenario>([
    'token_error',
    'wrong_nonce',
    'wrong_audience',
    'wrong_issuer',
    'expired_id_token',
    'slow_token',
  ])(
    'escenario %s → ProviderFailedError a tiempo y sin datos sensibles en el log',
    async (scenario) => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const started = Date.now();
      await expect(flow({ scenario })).rejects.toBeInstanceOf(ProviderFailedError);
      expect(Date.now() - started).toBeLessThan(TIMEOUT_MS + 1000);
      expect(warn).toHaveBeenCalledTimes(1);
      const entry = warn.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(Object.keys(entry).sort()).toEqual(
        ['code', 'event', 'name', 'oauthError', 'provider', 'stage'].sort(),
      );
      expect(entry).toMatchObject({ event: 'oauth_provider_error', provider: 'google' });
      warn.mockRestore();
    },
  );
});
