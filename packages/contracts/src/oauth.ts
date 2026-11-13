import { z } from 'zod';
import {
  authResponseSchema,
  birthDateSchema,
  emailSchema,
  passwordInputSchema,
  publicUserSchema,
  registerRequestSchema,
  strictObjectError,
} from './auth.js';

/** Proveedores de entrada. Añadir uno exige también una migración de las CHECK. */
export const OAUTH_PROVIDERS = ['google', 'facebook'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** Pantalla desde la que se empieza a entrar con un proveedor sin sesión. */
export const OAUTH_ENTRY_POINTS = ['login', 'register'] as const;
export type OAuthEntryPoint = (typeof OAUTH_ENTRY_POINTS)[number];

/** Vida de la fila de `oauth_states` (flujo en curso). */
export const OAUTH_FLOW_TTL_MINUTES = 10;
/** Vida de la fila de `pending_identities` (alta o unión pendiente). */
export const OAUTH_PENDING_TTL_MINUTES = 30;
/** Fallos de contraseña permitidos en una unión antes de borrar el estado pendiente. */
export const OAUTH_LINK_MAX_FAILURES = 5;
/** Una sesión es reciente si se autenticó hace menos de esto (§9.1). */
export const RECENT_AUTH_MAX_AGE_MINUTES = 10;

const entryPointSchema = z.enum(OAUTH_ENTRY_POINTS, { error: 'invalid' });

/** Token opaco de 256 bits en base64url (43 caracteres), como el de sesión. */
const opaqueTokenSchema = z
  .string({ error: 'required' })
  .regex(/^[A-Za-z0-9_-]{43}$/, { error: 'invalid_format' });

/**
 * Ruta de vuelta tras el proveedor. Solo minúsculas, guiones y barras, y nunca `//` (que el
 * navegador leería como otro origen). La web aplica además `safeReturnPath`, con su lista cerrada.
 */
const returnPathSchema = z
  .string({ error: 'invalid_format' })
  .max(64, { error: 'too_long' })
  .regex(/^\/[a-z/-]*$/, { error: 'invalid_format', abort: true })
  .refine((value) => !value.includes('//'), { error: 'invalid_format' });

const expiresAtSchema = z.iso.datetime();

/** Token pendiente (alta o unión) que la web guarda en la cookie `cupidilla_oauth`. */
export const pendingTokenSchema = z.object({
  token: opaqueTokenSchema,
  expiresAt: expiresAtSchema,
});
export type PendingToken = z.infer<typeof pendingTokenSchema>;

const sessionTokenSchema = z.object({ token: z.string(), expiresAt: expiresAtSchema });

/** POST /auth/oauth/:provider/authorization (sin sesión). */
export const oauthStartRequestSchema = z.strictObject(
  { entryPoint: entryPointSchema, returnPath: returnPathSchema.optional() },
  { error: strictObjectError },
);
export type OAuthStartRequest = z.infer<typeof oauthStartRequestSchema>;

/** POST /users/me/oauth/:provider/authorization (con sesión). */
export const oauthSessionStartRequestSchema = z.strictObject(
  {
    purpose: z.enum(['reauthenticate', 'connect'], { error: 'invalid' }),
    returnPath: returnPathSchema.optional(),
  },
  { error: strictObjectError },
);
export type OAuthSessionStartRequest = z.infer<typeof oauthSessionStartRequestSchema>;

export const oauthStartResponseSchema = z.object({
  authorizationUrl: z.url(),
  flowToken: opaqueTokenSchema,
  expiresAt: expiresAtSchema,
});
export type OAuthStartResponse = z.infer<typeof oauthStartResponseSchema>;

/** POST /auth/oauth/:provider/callback: la consulta de la vuelta, tal cual, sin el `?`. */
export const oauthCallbackRequestSchema = z.strictObject(
  {
    flowToken: opaqueTokenSchema,
    callbackQuery: z.string({ error: 'required' }).max(4096, { error: 'too_long' }),
  },
  { error: strictObjectError },
);
export type OAuthCallbackRequest = z.infer<typeof oauthCallbackRequestSchema>;

export const OAUTH_FAILURE_REASONS = [
  'cancelled',
  'provider_failed',
  'email_missing',
  'email_unverified',
  'identity_mismatch',
  'identity_in_use',
  'already_linked',
] as const;
export type OAuthFailureReason = (typeof OAUTH_FAILURE_REASONS)[number];

/** Resultado de la vuelta. `failed` es un 200: la web necesita saber a qué página volver. */
export const oauthCallbackResponseSchema = z.discriminatedUnion('result', [
  z.object({
    result: z.literal('signed_in'),
    user: publicUserSchema,
    session: sessionTokenSchema,
    returnPath: returnPathSchema.nullable(),
  }),
  z.object({ result: z.literal('signup_required'), pending: pendingTokenSchema }),
  z.object({ result: z.literal('link_required'), pending: pendingTokenSchema }),
  z.object({
    result: z.literal('use_other_provider'),
    providers: z.array(z.enum(OAUTH_PROVIDERS)).min(1),
  }),
  z.object({ result: z.literal('reauthenticated'), returnPath: returnPathSchema.nullable() }),
  z.object({ result: z.literal('connected') }),
  z.object({
    result: z.literal('failed'),
    reason: z.enum(OAUTH_FAILURE_REASONS),
    entryPoint: z.enum([...OAUTH_ENTRY_POINTS, 'account']),
    returnPath: returnPathSchema.nullable(),
  }),
]);
export type OAuthCallbackResponse = z.infer<typeof oauthCallbackResponseSchema>;

/** GET /auth/oauth/pending: lo necesario para pintar /register/complete y /login/link. */
export const pendingIdentityResponseSchema = z.object({
  kind: z.enum(['signup', 'link']),
  provider: z.enum(OAUTH_PROVIDERS),
  email: z.string(),
  entryPoint: z.enum(OAUTH_ENTRY_POINTS),
  expiresAt: expiresAtSchema,
});
export type PendingIdentityResponse = z.infer<typeof pendingIdentityResponseSchema>;

/** POST /auth/oauth/signup. El correo no viaja: la API usa el de la fila pendiente. */
export const oauthSignupRequestSchema = z.strictObject(
  {
    pendingToken: opaqueTokenSchema,
    birthDate: birthDateSchema,
    acceptTerms: z.literal(true, { error: 'required' }),
    termsVersion: registerRequestSchema.shape.termsVersion,
  },
  { error: strictObjectError },
);
export type OAuthSignupRequest = z.infer<typeof oauthSignupRequestSchema>;

/** POST /auth/oauth/link. `email` es el de la cuenta, para el cubo de intentos de /auth/login. */
export const oauthLinkRequestSchema = z.strictObject(
  { pendingToken: opaqueTokenSchema, email: emailSchema, password: passwordInputSchema },
  { error: strictObjectError },
);
export type OAuthLinkRequest = z.infer<typeof oauthLinkRequestSchema>;

/** POST /auth/oauth/pending/cancellation. */
export const oauthCancelPendingRequestSchema = z.strictObject(
  { pendingToken: opaqueTokenSchema },
  { error: strictObjectError },
);
export type OAuthCancelPendingRequest = z.infer<typeof oauthCancelPendingRequestSchema>;

/** Respuesta del alta y de la unión: la de registro y login, más la ruta de vuelta. */
export const oauthAuthResponseSchema = authResponseSchema.extend({
  returnPath: returnPathSchema.nullable(),
});
export type OAuthAuthResponse = z.infer<typeof oauthAuthResponseSchema>;

/** GET /auth/oauth/providers: los proveedores con credenciales configuradas. */
export const oauthProvidersResponseSchema = z.object({
  providers: z.array(z.enum(OAUTH_PROVIDERS)),
});
export type OAuthProvidersResponse = z.infer<typeof oauthProvidersResponseSchema>;
