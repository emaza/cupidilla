import type { NestExpressApplication } from '@nestjs/platform-express';
import { SERVICE_TERMS_VERSION, type OAuthProvider } from '@cupidilla/contracts';
import { completeFakeAuthorization, type FakeIdentity } from '@cupidilla/fake-oauth-provider';
import { randomUUID } from 'node:crypto';
import { api } from './test-app.js';

export interface FlowOptions {
  provider?: OAuthProvider;
  entryPoint?: 'login' | 'register';
  returnPath?: string;
  identity?: Partial<FakeIdentity>;
  decision?: 'approve' | 'deny';
  /** IP del cliente: por defecto, una distinta por llamada. */
  ip?: string;
}

/** Identidad nueva de Google con correo verificado. */
export function newIdentity(overrides: Partial<FakeIdentity> = {}): FakeIdentity {
  return {
    subject: `sub-${randomUUID()}`,
    email: `persona+${randomUUID()}@example.com`,
    emailVerified: true,
    ...overrides,
  };
}

/** POST /auth/oauth/:provider/authorization. */
export function startFlow(
  app: NestExpressApplication,
  { provider = 'google', entryPoint = 'login', returnPath, ip }: FlowOptions = {},
) {
  return api(app, ip)
    .post(`/auth/oauth/${provider}/authorization`)
    .send({ entryPoint, ...(returnPath ? { returnPath } : {}) });
}

/**
 * Empieza un flujo, pasa por el formulario del proveedor falso y devuelve lo necesario para la
 * vuelta: el `flowToken` y la consulta tal como la recibiría la web.
 */
export async function authorize(app: NestExpressApplication, options: FlowOptions = {}) {
  const started = await startFlow(app, options);
  if (started.status !== 201) {
    throw new Error(`Inicio fallido: ${started.status} ${JSON.stringify(started.body)}`);
  }
  const { flowToken, authorizationUrl } = started.body as {
    flowToken: string;
    authorizationUrl: string;
  };
  const identity = newIdentity(options.identity);
  const callback = await completeFakeAuthorization(authorizationUrl, {
    ...identity,
    decision: options.decision,
  });
  return { flowToken, authorizationUrl, callbackQuery: callback.search.slice(1), identity };
}

/** Vuelta del proveedor: POST /auth/oauth/:provider/callback. */
export function callback(
  app: NestExpressApplication,
  body: { flowToken: string; callbackQuery: string },
  { provider = 'google', ip }: { provider?: OAuthProvider; ip?: string } = {},
) {
  // Solo los dos campos del contrato: el esquema es estricto.
  const { flowToken, callbackQuery } = body;
  return api(app, ip).post(`/auth/oauth/${provider}/callback`).send({ flowToken, callbackQuery });
}

/** Flujo completo hasta la respuesta de la vuelta. */
export async function runFlow(app: NestExpressApplication, options: FlowOptions = {}) {
  const flow = await authorize(app, options);
  const response = await callback(app, flow, options);
  return { ...flow, response };
}

export function signupBody(pendingToken: string, overrides: Record<string, unknown> = {}) {
  return {
    pendingToken,
    birthDate: '1990-05-05',
    acceptTerms: true,
    termsVersion: SERVICE_TERMS_VERSION,
    ...overrides,
  };
}
