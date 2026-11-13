/**
 * Proveedor OAuth falso para las pruebas (diseño técnico §14.1): imita lo que Cupidilla usa de
 * Google (OIDC) y de Facebook (OAuth 2 + Graph) y valida lo que importa: el `client_id`, la
 * `redirect_uri` exacta, el secreto, PKCE S256, el `state` y el `nonce`, y los códigos de un solo
 * uso. Sin dependencias: `node:http` y `node:crypto`.
 *
 * Nunca debe usarse fuera de las pruebas: no tiene ninguna seguridad propia.
 */
import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomBytes,
  sign,
  timingSafeEqual,
} from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Qué hace el proveedor con un código concreto. Va en el código, no en el servidor: así no hay
 * estado global y las pruebas pueden ir en paralelo.
 */
export const FAKE_SCENARIOS = [
  'ok',
  'token_error',
  'wrong_nonce',
  'wrong_audience',
  'wrong_issuer',
  'expired_id_token',
  'slow_token',
  'graph_error',
] as const;
export type FakeScenario = (typeof FAKE_SCENARIOS)[number];

export type FakeProviderName = 'google' | 'facebook';

export interface FakeProviderOptions {
  /** 0 (por defecto) elige un puerto libre. */
  port?: number;
  host?: string;
  google: { clientId: string; clientSecret: string; redirectUris: readonly string[] };
  facebook: { appId: string; appSecret: string; redirectUris: readonly string[] };
  /** Lo que tarda en responder el *token endpoint* con `slow_token`. Por defecto, 6 s. */
  slowResponseMs?: number;
}

export interface FakeProvider {
  /** Origen del proveedor, sin barra final (p. ej. `http://127.0.0.1:4401`). */
  url: string;
  close(): Promise<void>;
}

export interface FakeIdentity {
  /** `sub` de Google o `id` de Facebook. */
  subject: string;
  /** Vacío o ausente: el proveedor no devuelve correo. */
  email?: string;
  /** Solo Google. Por defecto, `true`. */
  emailVerified?: boolean;
  scenario?: FakeScenario;
}

interface CodeRecord {
  provider: FakeProviderName;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  nonce: string;
  identity: Required<Pick<FakeIdentity, 'subject' | 'emailVerified'>> & { email: string };
  scenario: FakeScenario;
  expiresAt: number;
  used: boolean;
}

interface AccessTokenRecord {
  subject: string;
  email: string;
  scenario: FakeScenario;
}

const CODE_TTL_MS = 60_000;

const base64url = (value: Buffer | string): string => Buffer.from(value).toString('base64url');

const sha256base64url = (value: string): string =>
  createHash('sha256').update(value).digest('base64url');

const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );

const isScenario = (value: string): value is FakeScenario =>
  (FAKE_SCENARIOS as readonly string[]).includes(value);

/**
 * Identificador por defecto: estable para un mismo proveedor y correo, como el `sub` de una
 * cuenta real; sin correo, uno nuevo cada vez.
 */
export function subjectFor(provider: FakeProviderName, email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return base64url(randomBytes(9));
  return `fake-${createHash('sha256').update(`${provider}:${normalized}`).digest('base64url').slice(0, 16)}`;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function send(
  res: ServerResponse,
  status: number,
  body: string,
  contentType = 'text/plain; charset=utf-8',
): void {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(body);
}

const sendJson = (res: ServerResponse, status: number, body: unknown): void =>
  send(res, status, JSON.stringify(body), 'application/json; charset=utf-8');

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(303, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

/** Parámetros de la autorización que el proveedor exige, según el proveedor. */
const REQUIRED_AUTH_PARAMS: Record<FakeProviderName, readonly string[]> = {
  google: [
    'client_id',
    'redirect_uri',
    'response_type',
    'scope',
    'state',
    'nonce',
    'code_challenge',
    'code_challenge_method',
  ],
  facebook: [
    'client_id',
    'redirect_uri',
    'response_type',
    'scope',
    'state',
    'code_challenge',
    'code_challenge_method',
  ],
};

export async function startFakeOAuthProvider(options: FakeProviderOptions): Promise<FakeProvider> {
  const host = options.host ?? '127.0.0.1';
  const slowResponseMs = options.slowResponseMs ?? 6000;
  const codes = new Map<string, CodeRecord>();
  const accessTokens = new Map<string, AccessTokenRecord>();
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = base64url(randomBytes(8));
  let origin = '';

  const clientFor = (provider: FakeProviderName) =>
    provider === 'google'
      ? {
          id: options.google.clientId,
          secret: options.google.clientSecret,
          uris: options.google.redirectUris,
        }
      : {
          id: options.facebook.appId,
          secret: options.facebook.appSecret,
          uris: options.facebook.redirectUris,
        };

  /** Comprueba la petición de autorización. Devuelve el motivo del rechazo, o `null`. */
  function invalidAuthorization(
    provider: FakeProviderName,
    params: URLSearchParams,
  ): string | null {
    for (const name of REQUIRED_AUTH_PARAMS[provider]) {
      if (!params.get(name)) return `falta ${name}`;
    }
    const client = clientFor(provider);
    if (params.get('client_id') !== client.id) return 'client_id desconocido';
    if (!client.uris.includes(params.get('redirect_uri') ?? ''))
      return 'redirect_uri no registrada';
    if (params.get('response_type') !== 'code') return 'response_type no admitido';
    if (params.get('code_challenge_method') !== 'S256') return 'code_challenge_method no admitido';
    const scopes = (params.get('scope') ?? '').split(' ');
    if (!scopes.includes('email')) return 'falta el scope email';
    if (provider === 'google' && !scopes.includes('openid')) return 'falta el scope openid';
    return null;
  }

  function authorizationForm(provider: FakeProviderName, params: URLSearchParams): string {
    const hidden = [...params]
      .map(
        ([name, value]) =>
          `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
      )
      .join('\n');
    const options = FAKE_SCENARIOS.map(
      (scenario) => `<option value="${scenario}">${scenario}</option>`,
    ).join('');
    const title = provider === 'google' ? 'Google (falso)' : 'Facebook (falso)';
    return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${title}</title></head>
<body>
<h1>${title}</h1>
<form method="POST">
${hidden}
<p><label for="sub">Identificador</label> <input id="sub" name="sub" aria-describedby="sub-help"></p>
<p id="sub-help">Vacío: se calcula a partir del correo, así que el mismo correo es siempre la misma cuenta.</p>
<p><label for="email">Correo</label> <input id="email" name="email" type="email"></p>
<p><label><input name="email_verified" type="checkbox" checked> Correo verificado</label></p>
<p><label for="scenario">Escenario</label> <select id="scenario" name="scenario">${options}</select></p>
<p><button name="decision" value="approve">Autorizar</button>
<button name="decision" value="deny">Cancelar</button></p>
</form>
</body></html>`;
  }

  function handleAuthorizeGet(provider: FakeProviderName, url: URL, res: ServerResponse): void {
    const problem = invalidAuthorization(provider, url.searchParams);
    if (problem) return send(res, 400, `Petición de autorización no válida: ${problem}`);
    send(res, 200, authorizationForm(provider, url.searchParams), 'text/html; charset=utf-8');
  }

  async function handleAuthorizePost(
    provider: FakeProviderName,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const form = new URLSearchParams(await readBody(req));
    const params = new URLSearchParams();
    for (const name of [...REQUIRED_AUTH_PARAMS[provider], 'prompt', 'login_hint', 'auth_type']) {
      const value = form.get(name);
      if (value !== null) params.set(name, value);
    }
    const problem = invalidAuthorization(provider, params);
    if (problem) return send(res, 400, `Petición de autorización no válida: ${problem}`);

    const callback = new URL(params.get('redirect_uri') ?? '');
    const state = params.get('state') ?? '';
    const iss = `${origin}/google`;

    if (form.get('decision') !== 'approve') {
      callback.searchParams.set('error', 'access_denied');
      if (provider === 'facebook') callback.searchParams.set('error_reason', 'user_denied');
      callback.searchParams.set('state', state);
      if (provider === 'google') callback.searchParams.set('iss', iss);
      return redirect(res, callback.toString());
    }

    const scenarioValue = form.get('scenario') ?? 'ok';
    const code = base64url(randomBytes(24));
    codes.set(code, {
      provider,
      clientId: params.get('client_id') ?? '',
      redirectUri: params.get('redirect_uri') ?? '',
      codeChallenge: params.get('code_challenge') ?? '',
      nonce: params.get('nonce') ?? '',
      identity: {
        subject: (form.get('sub') ?? '').trim() || subjectFor(provider, form.get('email') ?? ''),
        email: (form.get('email') ?? '').trim(),
        emailVerified: form.get('email_verified') !== null,
      },
      scenario: isScenario(scenarioValue) ? scenarioValue : 'ok',
      expiresAt: Date.now() + CODE_TTL_MS,
      used: false,
    });
    callback.searchParams.set('code', code);
    callback.searchParams.set('state', state);
    if (provider === 'google') callback.searchParams.set('iss', iss);
    redirect(res, callback.toString());
  }

  /** Canje común: valida secreto, código, `redirect_uri` y PKCE. Consume el código. */
  function redeem(
    provider: FakeProviderName,
    body: URLSearchParams,
  ): { ok: true; record: CodeRecord } | { ok: false; status: number; error: string } {
    const client = clientFor(provider);
    if (
      body.get('client_id') !== client.id ||
      !safeEqual(body.get('client_secret') ?? '', client.secret)
    ) {
      return { ok: false, status: 401, error: 'invalid_client' };
    }
    if (provider === 'google' && body.get('grant_type') !== 'authorization_code') {
      return { ok: false, status: 400, error: 'unsupported_grant_type' };
    }
    const code = body.get('code') ?? '';
    const record = codes.get(code);
    if (!record || record.used || record.provider !== provider || record.expiresAt < Date.now()) {
      return { ok: false, status: 400, error: 'invalid_grant' };
    }
    record.used = true;
    if (record.redirectUri !== body.get('redirect_uri')) {
      return { ok: false, status: 400, error: 'invalid_grant' };
    }
    if (sha256base64url(body.get('code_verifier') ?? '') !== record.codeChallenge) {
      return { ok: false, status: 400, error: 'invalid_grant' };
    }
    return { ok: true, record };
  }

  function idToken(record: CodeRecord): string {
    const now = Math.floor(Date.now() / 1000);
    const scenario = record.scenario;
    const claims: Record<string, unknown> = {
      iss: scenario === 'wrong_issuer' ? 'https://otro-emisor.example' : `${origin}/google`,
      aud: scenario === 'wrong_audience' ? 'otro-cliente' : record.clientId,
      azp: record.clientId,
      sub: record.identity.subject,
      nonce: scenario === 'wrong_nonce' ? 'otro-nonce' : record.nonce,
      iat: scenario === 'expired_id_token' ? now - 7200 : now,
      exp: scenario === 'expired_id_token' ? now - 3600 : now + 3600,
    };
    if (record.identity.email) {
      claims.email = record.identity.email;
      claims.email_verified = record.identity.emailVerified;
    }
    const header = base64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
    const payload = base64url(JSON.stringify(claims));
    const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey);
    return `${header}.${payload}.${base64url(signature)}`;
  }

  async function handleToken(
    provider: FakeProviderName,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const result = redeem(provider, new URLSearchParams(await readBody(req)));
    if (!result.ok) {
      return provider === 'google'
        ? sendJson(res, result.status, { error: result.error })
        : sendJson(res, 400, {
            error: { message: result.error, type: 'OAuthException', code: 100 },
          });
    }
    const { record } = result;
    if (record.scenario === 'token_error') {
      return sendJson(res, 400, { error: 'invalid_grant' });
    }
    if (record.scenario === 'slow_token') {
      await new Promise((done) => setTimeout(done, slowResponseMs));
    }
    const accessToken = base64url(randomBytes(24));
    if (provider === 'google') {
      return sendJson(res, 200, {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 3599,
        scope: 'openid https://www.googleapis.com/auth/userinfo.email',
        id_token: idToken(record),
      });
    }
    accessTokens.set(accessToken, {
      subject: record.identity.subject,
      email: record.identity.email,
      scenario: record.scenario,
    });
    sendJson(res, 200, { access_token: accessToken, token_type: 'bearer', expires_in: 5183944 });
  }

  function handleGraphMe(req: IncomingMessage, url: URL, res: ServerResponse): void {
    const graphError = (status: number, message: string) =>
      sendJson(res, status, { error: { message, type: 'OAuthException', code: 190 } });
    const authorization = req.headers.authorization ?? '';
    const token = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : (url.searchParams.get('access_token') ?? '');
    const record = accessTokens.get(token);
    if (!record) return graphError(400, 'Invalid OAuth access token');
    const expectedProof = createHmac('sha256', options.facebook.appSecret)
      .update(token)
      .digest('hex');
    if (!safeEqual(url.searchParams.get('appsecret_proof') ?? '', expectedProof)) {
      return graphError(400, 'Invalid appsecret_proof provided in the API argument');
    }
    if (record.scenario === 'graph_error') return graphError(500, 'An unknown error occurred');
    const fields = (url.searchParams.get('fields') ?? 'id').split(',');
    const body: Record<string, string> = { id: record.subject };
    if (fields.includes('email') && record.email) body.email = record.email;
    sendJson(res, 200, body);
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', origin);
    const key = `${req.method ?? 'GET'} ${url.pathname}`;
    switch (key) {
      case 'GET /google/authorize':
        return handleAuthorizeGet('google', url, res);
      case 'POST /google/authorize':
        return handleAuthorizePost('google', req, res);
      case 'POST /google/token':
        return handleToken('google', req, res);
      case 'GET /facebook/dialog/oauth':
        return handleAuthorizeGet('facebook', url, res);
      case 'POST /facebook/dialog/oauth':
        return handleAuthorizePost('facebook', req, res);
      case 'POST /facebook/oauth/access_token':
        return handleToken('facebook', req, res);
      case 'GET /facebook/me':
        return handleGraphMe(req, url, res);
      case 'GET /health':
        return send(res, 200, 'ok');
      default:
        return send(res, 404, 'No encontrado');
    }
  }

  const server = createServer((req, res) => {
    route(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, 'Error interno del proveedor falso');
      else res.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  origin = `http://${host}:${port}`;

  return {
    url: origin,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * Hace por HTTP lo que haría una persona en el formulario del proveedor: carga la autorización y
 * pulsa «Autorizar» (o «Cancelar»). Devuelve la URL de vuelta a la que redirige el proveedor.
 * Lanza un error si el proveedor rechaza la petición de autorización.
 */
export async function completeFakeAuthorization(
  authorizationUrl: string,
  identity: FakeIdentity & { decision?: 'approve' | 'deny' },
): Promise<URL> {
  const page = await fetch(authorizationUrl);
  if (page.status !== 200) {
    throw new Error(
      `El proveedor falso rechazó la autorización: ${page.status} ${await page.text()}`,
    );
  }
  const form = new URLSearchParams(new URL(authorizationUrl).searchParams);
  form.set('sub', identity.subject);
  form.set('email', identity.email ?? '');
  if (identity.emailVerified ?? true) form.set('email_verified', 'on');
  form.set('scenario', identity.scenario ?? 'ok');
  form.set('decision', identity.decision ?? 'approve');
  const answer = await fetch(
    new URL(authorizationUrl).origin + new URL(authorizationUrl).pathname,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      redirect: 'manual',
    },
  );
  const location = answer.headers.get('location');
  if (answer.status !== 303 || !location) {
    throw new Error(`El proveedor falso no redirigió: ${answer.status} ${await answer.text()}`);
  }
  return new URL(location);
}
