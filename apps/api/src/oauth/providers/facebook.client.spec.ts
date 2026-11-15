import { Logger } from '@nestjs/common';
import {
  completeFakeAuthorization,
  startFakeOAuthProvider,
  type FakeProvider,
  type FakeScenario,
} from '@cupidilla/fake-oauth-provider';
import { calculatePKCECodeChallenge, randomPKCECodeVerifier } from 'openid-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FacebookClient } from './facebook.client.js';
import { ProviderCancelledError, ProviderFailedError } from './provider-client.js';
import { FACEBOOK_GRAPH_VERSION, providerSettings } from './provider-config.js';

const BASE = 'http://localhost:5173';
const TIMEOUT_MS = 600;
const APP_SECRET = 'facebook-secreto';

let provider: FakeProvider;
let client: FacebookClient;

beforeAll(async () => {
  provider = await startFakeOAuthProvider({
    google: { clientId: 'g', clientSecret: 'x', redirectUris: [] },
    facebook: {
      appId: '1234567890',
      appSecret: APP_SECRET,
      redirectUris: [`${BASE}/auth/facebook/callback`],
    },
    slowResponseMs: TIMEOUT_MS + 400,
  });
  const settings = providerSettings({
    PUBLIC_WEB_URL: BASE,
    GOOGLE_CLIENT_ID: undefined,
    GOOGLE_CLIENT_SECRET: undefined,
    FACEBOOK_APP_ID: '1234567890',
    FACEBOOK_APP_SECRET: APP_SECRET,
    OAUTH_HTTP_TIMEOUT_MS: TIMEOUT_MS,
    OAUTH_FAKE_PROVIDER_URL: provider.url,
  }).facebook;
  if (!settings) throw new Error('Facebook sin configurar');
  client = new FacebookClient(settings);
});
afterAll(async () => {
  await provider.close();
});

async function flow(
  identity: { email?: string; scenario?: FakeScenario } = {},
  decision: 'approve' | 'deny' = 'approve',
) {
  const codeVerifier = randomPKCECodeVerifier();
  const url = client.authorizationUrl({
    state: 'estado-fb',
    nonce: 'no-se-usa',
    codeChallenge: await calculatePKCECodeChallenge(codeVerifier),
    reauthenticate: false,
  });
  const callback = await completeFakeAuthorization(url.toString(), {
    subject: '10220000123',
    email: 'Persona@Example.com',
    ...identity,
    decision,
  });
  return client.exchange({
    callbackQuery: callback.search.slice(1),
    state: 'estado-fb',
    codeVerifier,
    nonce: 'no-se-usa',
  });
}

describe('FacebookClient con el proveedor falso', () => {
  it('la URL pide solo email, con PKCE S256 y sin nonce', () => {
    const url = client.authorizationUrl({
      state: 's',
      nonce: 'n',
      codeChallenge: 'c',
      reauthenticate: false,
    });
    expect(url.origin + url.pathname).toBe(`${provider.url}/facebook/dialog/oauth`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: '1234567890',
      redirect_uri: `${BASE}/auth/facebook/callback`,
      response_type: 'code',
      scope: 'email',
      state: 's',
      code_challenge: 'c',
      code_challenge_method: 'S256',
    });
  });

  it('con reautenticación añade auth_type=reauthenticate', () => {
    const url = client.authorizationUrl({
      state: 's',
      nonce: 'n',
      codeChallenge: 'c',
      reauthenticate: true,
    });
    expect(url.searchParams.get('auth_type')).toBe('reauthenticate');
  });

  it('los endpoints reales usan la Graph v27.0', () => {
    const real = providerSettings({
      PUBLIC_WEB_URL: BASE,
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
      FACEBOOK_APP_ID: '1',
      FACEBOOK_APP_SECRET: 'x',
      OAUTH_HTTP_TIMEOUT_MS: 3000,
      OAUTH_FAKE_PROVIDER_URL: undefined,
    }).facebook;
    expect(FACEBOOK_GRAPH_VERSION).toBe('v27.0');
    expect(real).toMatchObject({
      authorizationEndpoint: 'https://www.facebook.com/v27.0/dialog/oauth',
      tokenEndpoint: 'https://graph.facebook.com/v27.0/oauth/access_token',
      userInfoEndpoint: 'https://graph.facebook.com/v27.0/me',
    });
  });

  it('canje y /me con appsecret_proof: el correo devuelto se da por verificado (R1)', async () => {
    await expect(flow()).resolves.toEqual({
      subject: '10220000123',
      email: 'persona@example.com',
      emailVerified: true,
    });
  });

  it('sin correo: email null y no verificado', async () => {
    await expect(flow({ email: '' })).resolves.toEqual({
      subject: '10220000123',
      email: null,
      emailVerified: false,
    });
  });

  it('cancelar en Facebook → ProviderCancelledError', async () => {
    await expect(flow({}, 'deny')).rejects.toBeInstanceOf(ProviderCancelledError);
  });

  it.each<FakeScenario>(['token_error', 'slow_token', 'graph_error'])(
    '%s → ProviderFailedError a tiempo, registrando solo datos saneados',
    async (scenario) => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const started = Date.now();
      await expect(flow({ scenario })).rejects.toBeInstanceOf(ProviderFailedError);
      expect(Date.now() - started).toBeLessThan(TIMEOUT_MS + 1000);
      expect(warn).toHaveBeenCalledTimes(1);
      const entry = warn.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(entry).toMatchObject({ event: 'oauth_provider_error', provider: 'facebook' });
      if (scenario === 'graph_error')
        expect(entry).toEqual({ ...entry, stage: 'graph', status: 500 });
      expect(JSON.stringify(entry)).not.toContain(APP_SECRET);
      warn.mockRestore();
    },
  );
});
