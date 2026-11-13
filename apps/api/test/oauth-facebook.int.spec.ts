import { oauthCallbackResponseSchema } from '@cupidilla/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pendingIdentities } from '../src/database/schema/index.js';
import { FAKE_PROVIDER_URL, OAUTH_REDIRECT_BASE_URL, OAUTH_TEST_ENV } from './helpers/oauth-env.js';
import { authorize, callback, runFlow, signupBody, startFlow } from './helpers/oauth.js';
import {
  api,
  countRows,
  createTestApp,
  registerUser,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

describe('Entrada con Facebook (fase 3)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await truncateAll(t.db);
    t.clock.set(TEST_NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const signup = (token: string) => api(t.app).post('/auth/oauth/signup').send(signupBody(token));

  it('inicio: URL de la Graph con scope email, PKCE y la redirect URI exacta', async () => {
    const response = await startFlow(t.app, { provider: 'facebook' });
    expect(response.status).toBe(201);
    const url = new URL(response.body.authorizationUrl as string);
    expect(url.origin + url.pathname).toBe(`${FAKE_PROVIDER_URL}/facebook/dialog/oauth`);
    expect(url.searchParams.get('redirect_uri')).toBe(
      `${OAUTH_REDIRECT_BASE_URL}/auth/facebook/callback`,
    );
    expect(url.searchParams.get('scope')).toBe('email');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.has('nonce')).toBe(false);
  });

  it('alta con Facebook: el correo devuelto se guarda como verificado (R1)', async () => {
    const flow = await runFlow(t.app, { provider: 'facebook', entryPoint: 'register' });
    expect(flow.response.body.result).toBe('signup_required');
    const [row] = await t.db.select().from(pendingIdentities);
    expect(row).toMatchObject({ provider: 'facebook', emailVerified: true, kind: 'signup' });
    expect((await signup(flow.response.body.pending.token as string)).status).toBe(201);

    const again = await runFlow(t.app, {
      provider: 'facebook',
      identity: { subject: flow.identity.subject, email: flow.identity.email },
    });
    expect(oauthCallbackResponseSchema.parse(again.response.body).result).toBe('signed_in');
  });

  it('O-10 (Facebook): sin correo → email_missing, sin consultar users ni guardar nada', async () => {
    const flow = await runFlow(t.app, { provider: 'facebook', identity: { email: '' } });
    expect(flow.response.body).toEqual({
      result: 'failed',
      reason: 'email_missing',
      entryPoint: 'login',
      returnPath: null,
    });
    expect(await countRows(t.db, 'pending_identities')).toBe(0);
  });

  it('O-11: correo de una cuenta sin contraseña creada con Google → use_other_provider [google]', async () => {
    const google = await runFlow(t.app);
    expect((await signup(google.response.body.pending.token as string)).status).toBe(201);
    const facebook = await runFlow(t.app, {
      provider: 'facebook',
      identity: { email: google.identity.email },
    });
    expect(facebook.response.body).toEqual({ result: 'use_other_provider', providers: ['google'] });
    expect(await countRows(t.db, 'identities')).toBe(1);
  });

  it('O-11: correo de una cuenta con contraseña → link_required', async () => {
    const existing = await registerUser(t.app);
    const flow = await runFlow(t.app, {
      provider: 'facebook',
      identity: { email: existing.email },
    });
    expect(flow.response.body.result).toBe('link_required');
    const [row] = await t.db.select().from(pendingIdentities);
    expect(row).toMatchObject({ provider: 'facebook', kind: 'link', userId: existing.userId });
  });

  it.each(['token_error', 'slow_token', 'graph_error'] as const)(
    'O-14: %s → failed provider_failed',
    async (scenario) => {
      const flow = await runFlow(t.app, { provider: 'facebook', identity: { scenario } });
      expect(flow.response.body).toMatchObject({ result: 'failed', reason: 'provider_failed' });
    },
  );

  it('cancelar en Facebook → failed cancelled', async () => {
    const flow = await runFlow(t.app, { provider: 'facebook', decision: 'deny' });
    expect(flow.response.body).toMatchObject({ result: 'failed', reason: 'cancelled' });
  });

  it('O-13: la fila de un flujo de Google no vale para la vuelta de Facebook', async () => {
    const flow = await authorize(t.app); // Google
    const response = await callback(t.app, flow, { provider: 'facebook' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('OAUTH_FLOW_INVALID');
    expect(await countRows(t.db, 'oauth_states')).toBe(0);
  });

  it('O-20 (Facebook): el log no lleva el access token, el secreto, el id ni el correo', async () => {
    const output: string[] = [];
    const capture = (chunk: unknown): boolean => {
      output.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(capture);
    vi.spyOn(process.stderr, 'write').mockImplementation(capture);
    const flows = [
      await runFlow(t.app, { provider: 'facebook' }),
      await runFlow(t.app, { provider: 'facebook', identity: { scenario: 'graph_error' } }),
      await runFlow(t.app, { provider: 'facebook', identity: { scenario: 'token_error' } }),
    ];
    vi.restoreAllMocks();
    const log = output.join('');
    expect(log).toContain('"stage":"graph"');
    for (const flow of flows) {
      for (const value of [
        flow.flowToken,
        flow.callbackQuery,
        flow.identity.subject,
        flow.identity.email ?? '-',
      ]) {
        expect(log).not.toContain(value);
      }
    }
    expect(log).not.toContain(OAUTH_TEST_ENV.FACEBOOK_APP_SECRET);
    expect(log).not.toContain('appsecret_proof');
  });
});
