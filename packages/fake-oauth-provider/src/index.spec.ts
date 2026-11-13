import { createHash, createHmac, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { completeFakeAuthorization, startFakeOAuthProvider, type FakeProvider } from './index.ts';

const GOOGLE = { clientId: 'google-cliente', clientSecret: 'google-secreto' };
const FACEBOOK = { appId: '1234567890', appSecret: 'facebook-secreto' };
const REDIRECT = {
  google: 'http://localhost:5173/auth/google/callback',
  facebook: 'http://localhost:5173/auth/facebook/callback',
};

const verifier = () => randomBytes(32).toString('base64url');
const challenge = (value: string) => createHash('sha256').update(value).digest('base64url');

let provider: FakeProvider;

beforeAll(async () => {
  provider = await startFakeOAuthProvider({
    google: { ...GOOGLE, redirectUris: [REDIRECT.google] },
    facebook: { ...FACEBOOK, redirectUris: [REDIRECT.facebook] },
    slowResponseMs: 300,
  });
});
afterAll(async () => {
  await provider.close();
});

function googleAuthorization(codeVerifier: string, overrides: Record<string, string> = {}): string {
  const url = new URL(`${provider.url}/google/authorize`);
  const params = {
    client_id: GOOGLE.clientId,
    redirect_uri: REDIRECT.google,
    response_type: 'code',
    scope: 'openid email',
    state: 'estado-1',
    nonce: 'nonce-1',
    code_challenge: challenge(codeVerifier),
    code_challenge_method: 'S256',
    ...overrides,
  };
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url.toString();
}

function facebookAuthorization(codeVerifier: string): string {
  const url = new URL(`${provider.url}/facebook/dialog/oauth`);
  const params = {
    client_id: FACEBOOK.appId,
    redirect_uri: REDIRECT.facebook,
    response_type: 'code',
    scope: 'email',
    state: 'estado-fb',
    code_challenge: challenge(codeVerifier),
    code_challenge_method: 'S256',
  };
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url.toString();
}

const post = (path: string, body: Record<string, string>) =>
  fetch(`${provider.url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });

const googleToken = (code: string, codeVerifier: string, overrides: Record<string, string> = {}) =>
  post('/google/token', {
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT.google,
    code_verifier: codeVerifier,
    client_id: GOOGLE.clientId,
    client_secret: GOOGLE.clientSecret,
    ...overrides,
  });

function decodeJwt(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
}

describe('autorización', () => {
  it('pinta el formulario con una petición válida', async () => {
    const response = await fetch(googleAuthorization(verifier()));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Autorizar');
    expect(html).toContain('Cancelar');
  });

  it.each([
    ['redirect_uri', 'http://localhost:5173/auth/google/callback/'],
    ['redirect_uri', 'http://127.0.0.1:5173/auth/google/callback'],
    ['client_id', 'otro'],
    ['response_type', 'token'],
    ['code_challenge_method', 'plain'],
    ['scope', 'openid'],
    ['nonce', ''],
  ])('rechaza %s = «%s»', async (name, value) => {
    const response = await fetch(googleAuthorization(verifier(), { [name]: value }));
    expect(response.status).toBe(400);
  });

  it('«Cancelar» vuelve con error=access_denied, el state y el iss', async () => {
    const callback = await completeFakeAuthorization(googleAuthorization(verifier()), {
      subject: 'sub-1',
      decision: 'deny',
    });
    expect(callback.origin + callback.pathname).toBe(REDIRECT.google);
    expect(callback.searchParams.get('error')).toBe('access_denied');
    expect(callback.searchParams.get('state')).toBe('estado-1');
    expect(callback.searchParams.get('iss')).toBe(`${provider.url}/google`);
    expect(callback.searchParams.has('code')).toBe(false);
  });
});

describe('Google: canje', () => {
  async function code(codeVerifier: string, scenario?: 'ok' | 'token_error' | 'slow_token') {
    const callback = await completeFakeAuthorization(googleAuthorization(codeVerifier), {
      subject: 'sub-google',
      email: 'persona@example.com',
      scenario,
    });
    expect(callback.searchParams.get('state')).toBe('estado-1');
    expect(callback.searchParams.get('iss')).toBe(`${provider.url}/google`);
    return callback.searchParams.get('code') ?? '';
  }

  it('devuelve un id_token con los claims de la identidad', async () => {
    const codeVerifier = verifier();
    const response = await googleToken(await code(codeVerifier), codeVerifier);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id_token: string; token_type: string };
    expect(body.token_type).toBe('Bearer');
    expect(decodeJwt(body.id_token)).toMatchObject({
      iss: `${provider.url}/google`,
      aud: GOOGLE.clientId,
      sub: 'sub-google',
      email: 'persona@example.com',
      email_verified: true,
      nonce: 'nonce-1',
    });
  });

  it('rechaza un secreto erróneo', async () => {
    const codeVerifier = verifier();
    const response = await googleToken(await code(codeVerifier), codeVerifier, {
      client_secret: 'otro',
    });
    expect(response.status).toBe(401);
  });

  it('rechaza un code_verifier erróneo', async () => {
    const codeVerifier = verifier();
    const response = await googleToken(await code(codeVerifier), verifier());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_grant' });
  });

  it('rechaza una redirect_uri distinta de la de la autorización', async () => {
    const codeVerifier = verifier();
    const response = await googleToken(await code(codeVerifier), codeVerifier, {
      redirect_uri: `${REDIRECT.google}x`,
    });
    expect(response.status).toBe(400);
  });

  it('un código solo vale una vez', async () => {
    const codeVerifier = verifier();
    const value = await code(codeVerifier);
    expect((await googleToken(value, codeVerifier)).status).toBe(200);
    expect((await googleToken(value, codeVerifier)).status).toBe(400);
  });

  it('escenarios token_error y slow_token', async () => {
    const failing = verifier();
    expect((await googleToken(await code(failing, 'token_error'), failing)).status).toBe(400);

    const slow = verifier();
    const slowCode = await code(slow, 'slow_token');
    const started = Date.now();
    expect((await googleToken(slowCode, slow)).status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(280);
  });
});

describe('Facebook: canje y Graph', () => {
  async function accessToken(email?: string, scenario?: 'graph_error'): Promise<string> {
    const codeVerifier = verifier();
    const callback = await completeFakeAuthorization(facebookAuthorization(codeVerifier), {
      subject: '10220000',
      email,
      scenario,
    });
    expect(callback.searchParams.has('iss')).toBe(false);
    const response = await post('/facebook/oauth/access_token', {
      client_id: FACEBOOK.appId,
      client_secret: FACEBOOK.appSecret,
      redirect_uri: REDIRECT.facebook,
      code: callback.searchParams.get('code') ?? '',
      code_verifier: codeVerifier,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { access_token: string; token_type: string };
    expect(body.token_type).toBe('bearer');
    return body.access_token;
  }

  const me = (
    token: string,
    proof = createHmac('sha256', FACEBOOK.appSecret).update(token).digest('hex'),
  ) =>
    fetch(`${provider.url}/facebook/me?fields=id,email&appsecret_proof=${proof}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

  it('/me devuelve id y correo con un appsecret_proof correcto', async () => {
    const response = await me(await accessToken('fb@example.com'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: '10220000', email: 'fb@example.com' });
  });

  it('/me sin correo si la identidad no lo tiene', async () => {
    expect(await (await me(await accessToken())).json()).toEqual({ id: '10220000' });
  });

  it('/me rechaza un appsecret_proof erróneo y el escenario graph_error', async () => {
    expect((await me(await accessToken('fb@example.com'), '00')).status).toBe(400);
    expect((await me(await accessToken('fb@example.com', 'graph_error'))).status).toBe(500);
  });
});
