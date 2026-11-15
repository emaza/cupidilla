import { DEFAULT_MIN_AGE, MIN_AGE_RANGE } from '@cupidilla/contracts';
import { z } from 'zod';

/**
 * Parámetros de DATABASE_URL que pg mezcla por encima de las opciones del pool y anularían los
 * límites de tiempo de §7.2 (p. ej. `?statement_timeout=0`). Se comparan sin mayúsculas.
 */
export const FORBIDDEN_DATABASE_URL_PARAMS = [
  'statement_timeout',
  'query_timeout',
  'idle_in_transaction_session_timeout',
  'connectiontimeoutmillis',
  'connect_timeout',
  'options',
] as const;

/**
 * No puede lanzar nunca: Zod 4 ejecuta el `refine` aunque `z.url()` ya haya fallado, y el
 * TypeError de `new URL` lleva la URL (con la contraseña) en `input` (BUG-QA-11). Una URL que no
 * se puede leer se da aquí por buena y el error lo pone `z.url()`.
 */
const hasForbiddenParam = (url: string): boolean =>
  URL.canParse(url) &&
  [...new URL(url).searchParams.keys()].some((key) =>
    (FORBIDDEN_DATABASE_URL_PARAMS as readonly string[]).includes(key.toLowerCase()),
  );

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** ¿Es una URL `http:` o `https:` de loopback? Nunca lanza (ver `hasForbiddenParam`). */
export const isLoopbackUrl = (url: string): boolean =>
  URL.canParse(url) && LOOPBACK_HOSTS.has(new URL(url).hostname);

/** Una variable vacía en el .env (`GOOGLE_CLIENT_ID=`) cuenta como ausente. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

/** Como `optional`, pero con un valor por defecto: vacía en el .env cuenta como ausente. */
const withDefault = (schema: z.ZodString | z.ZodEmail, fallback: string) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.default(fallback));

/** Valores de `EMAIL_*`: solo `true` o `false` (como `API_URL_ALLOW_HTTP` en la web). */
const booleanFlag = (name: string, fallback: boolean) =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .enum(['true', 'false'], { error: `${name} solo admite true o false.` })
      .default(fallback ? 'true' : 'false')
      .transform((value) => value === 'true'),
  );

/**
 * Dirección de `MAIL_FROM`: sola (`no-reply@x.es`) o con nombre (`Cupidilla <no-reply@x.es>`).
 * `undefined` si no es una dirección válida.
 */
export function mailFromAddress(value: string): string | undefined {
  const match = /^[^<>]*<([^<>]+)>$/.exec(value.trim());
  const address = (match?.[1] ?? value).trim();
  return z.email().safeParse(address).success ? address : undefined;
}

/** Dominios reservados para ejemplos y pruebas (RFC 2606 y 6761): no valen en producción. */
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org'];
const RESERVED_TLDS = ['example', 'test', 'invalid', 'localhost'];

export function isReservedMailDomain(address: string): boolean {
  const domain = address.slice(address.lastIndexOf('@') + 1).toLowerCase();
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  return (
    RESERVED_TLDS.includes(tld) ||
    RESERVED_DOMAINS.some((reserved) => domain === reserved || domain.endsWith(`.${reserved}`))
  );
}

/**
 * Reglas del inicio de sesión con terceros (diseño técnico §10.4). Los mensajes nombran la
 * variable y nunca muestran su valor.
 */
function checkOAuth(env: Record<string, unknown>, ctx: z.RefinementCtx): void {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });

  const pairs = [
    ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'],
  ] as const;
  for (const [id, secret] of pairs) {
    const hasId = env[id] !== undefined;
    const hasSecret = env[secret] !== undefined;
    if (hasId !== hasSecret) {
      issue(hasId ? secret : id, `${id} y ${secret} van juntas: pon las dos o ninguna.`);
    }
  }

  const fake = env.OAUTH_FAKE_PROVIDER_URL;
  if (typeof fake === 'string') {
    if (env.NODE_ENV === 'production') {
      issue(
        'OAUTH_FAKE_PROVIDER_URL',
        'OAUTH_FAKE_PROVIDER_URL es solo para pruebas: no vale con NODE_ENV=production.',
      );
    }
    if (!isLoopbackUrl(fake)) {
      issue('OAUTH_FAKE_PROVIDER_URL', 'OAUTH_FAKE_PROVIDER_URL tiene que apuntar a loopback.');
    }
  }
}

/**
 * Origen público de la web (correo §8.1, antes `OAUTH_REDIRECT_BASE_URL`): base de los enlaces
 * de los correos y de la redirect URI de OAuth.
 */
function checkPublicWebUrl(env: Record<string, unknown>, ctx: z.RefinementCtx): void {
  const base = env.PUBLIC_WEB_URL;
  if (typeof base !== 'string' || !URL.canParse(base)) return;
  const issue = (message: string) =>
    ctx.addIssue({ code: 'custom', path: ['PUBLIC_WEB_URL'], message });
  const url = new URL(base);
  if (url.origin !== base) {
    issue(
      'PUBLIC_WEB_URL debe ser solo el origen de la web: sin ruta, sin barra final y sin consulta.',
    );
  } else if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackUrl(base))) {
    issue('PUBLIC_WEB_URL debe usar https: (o http: en loopback).');
  }
}

/**
 * Reglas del correo (correo §8.1). Los mensajes nombran la variable y nunca muestran su valor:
 * `SMTP_URL` puede llevar la clave del servidor.
 */
function checkMail(env: Record<string, unknown>, ctx: z.RefinementCtx): void {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });
  const production = env.NODE_ENV === 'production';
  const smtpUrl = env.SMTP_URL;

  if (smtpUrl === undefined && env.NODE_ENV !== 'test') {
    issue('SMTP_URL', 'SMTP_URL es obligatoria (salvo con NODE_ENV=test).');
  }
  if (production && typeof smtpUrl === 'string' && isLoopbackUrl(smtpUrl)) {
    issue('SMTP_URL', 'SMTP_URL no puede apuntar a loopback con NODE_ENV=production.');
  }

  const from = typeof env.MAIL_FROM === 'string' ? mailFromAddress(env.MAIL_FROM) : undefined;
  if (from === undefined) {
    issue('MAIL_FROM', 'MAIL_FROM tiene que ser una dirección de correo, sola o con nombre.');
  } else if (production && isReservedMailDomain(from)) {
    issue('MAIL_FROM', 'MAIL_FROM necesita un dominio real con NODE_ENV=production.');
  }
  const support = env.MAIL_SUPPORT_ADDRESS;
  if (production && typeof support === 'string' && isReservedMailDomain(support)) {
    issue(
      'MAIL_SUPPORT_ADDRESS',
      'MAIL_SUPPORT_ADDRESS necesita un dominio real con NODE_ENV=production.',
    );
  }
}

/** Variables de entorno de la API. Si alguna no es válida, la API no arranca. */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_HOST: z.string().default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).refine((url) => !hasForbiddenParam(url), {
      error:
        'DATABASE_URL no puede llevar statement_timeout, query_timeout, idle_in_transaction_session_timeout, connectionTimeoutMillis, connect_timeout ni options: anularían los límites de tiempo. Usa las variables DB_*_MS.',
    }),
    // Límites de PostgreSQL en ms (§7.2). Máximo 4000: la API responde antes de los 5 s de la web
    // (el query_timeout del cliente es DB_STATEMENT_TIMEOUT_MS + 500).
    DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1).max(4000).default(3000),
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1).max(4000).default(4000),
    DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().min(1).max(600_000).default(10_000),
    INTERNAL_API_KEY: z.string().min(32),
    // Edad mínima para usar la app en esta instalación (cada país). Sin reinicio en caliente.
    MIN_AGE: z.coerce
      .number({ error: 'MIN_AGE tiene que ser un número entero.' })
      .int({ error: 'MIN_AGE tiene que ser un número entero.' })
      .min(MIN_AGE_RANGE.min, { error: `MIN_AGE no puede ser menor que ${MIN_AGE_RANGE.min}.` })
      .max(MIN_AGE_RANGE.max, { error: `MIN_AGE no puede ser mayor que ${MIN_AGE_RANGE.max}.` })
      .default(DEFAULT_MIN_AGE),
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    RATE_LIMIT_FACTOR: z.coerce.number().int().min(1).max(1000).default(1),
    LOG_FORMAT: z.enum(['pretty', 'json']).default('pretty'),
    // Origen público de la web, sin barra final (correo §8.1). Sustituye a OAUTH_REDIRECT_BASE_URL.
    PUBLIC_WEB_URL: z.url({
      protocol: /^https?$/,
      error: 'PUBLIC_WEB_URL es obligatoria: el origen http(s) de la web, sin barra final.',
    }),
    // Un .env antiguo no falla en silencio (correo §8.1).
    OAUTH_REDIRECT_BASE_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.undefined({ error: 'OAUTH_REDIRECT_BASE_URL ya no existe: usa PUBLIC_WEB_URL' }),
    ),
    // Correo (correo §8.1). Sin SMTP_URL solo se arranca con NODE_ENV=test (MemoryMailer).
    SMTP_URL: optional(
      z.url({
        protocol: /^smtps?$/,
        error: 'SMTP_URL tiene que ser una URL smtp:// o smtps://.',
      }),
    ),
    // Por defecto, valores de ejemplo para desarrollo y tests; en producción no valen (decisión 10).
    MAIL_FROM: withDefault(z.string(), 'Cupidilla <no-reply@example.com>'),
    MAIL_SUPPORT_ADDRESS: withDefault(
      z.email({ error: 'MAIL_SUPPORT_ADDRESS tiene que ser una dirección de correo.' }),
      'soporte@example.com',
    ),
    EMAIL_UNVERIFIED_REMINDER: booleanFlag('EMAIL_UNVERIFIED_REMINDER', true),
    EMAIL_PASSWORD_CHANGED_NOTICE: booleanFlag('EMAIL_PASSWORD_CHANGED_NOTICE', true),
    // Inicio de sesión con terceros (§10.4). Un proveedor solo se activa con su pareja completa.
    GOOGLE_CLIENT_ID: optional(z.string().min(1)),
    GOOGLE_CLIENT_SECRET: optional(z.string().min(1)),
    FACEBOOK_APP_ID: optional(
      z.string().regex(/^\d+$/, { error: 'FACEBOOK_APP_ID solo lleva números.' }),
    ),
    FACEBOOK_APP_SECRET: optional(z.string().min(1)),
    // Cada petición al proveedor; la vuelta hace hasta dos (12 s en la web, §11.1).
    OAUTH_HTTP_TIMEOUT_MS: z.coerce.number().int().min(500).max(4000).default(3000),
    // Solo pruebas: apunta los dos proveedores al proveedor falso local.
    OAUTH_FAKE_PROVIDER_URL: optional(z.url({ protocol: /^http$/ })),
  })
  .superRefine((env, ctx) => {
    checkOAuth(env, ctx);
    checkPublicWebUrl(env, ctx);
    checkMail(env, ctx);
  });

export type Env = z.infer<typeof envSchema>;
