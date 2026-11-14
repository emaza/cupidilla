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
  let anyProvider = false;
  for (const [id, secret] of pairs) {
    const hasId = env[id] !== undefined;
    const hasSecret = env[secret] !== undefined;
    if (hasId !== hasSecret) {
      issue(hasId ? secret : id, `${id} y ${secret} van juntas: pon las dos o ninguna.`);
    }
    anyProvider ||= hasId && hasSecret;
  }

  const base = env.OAUTH_REDIRECT_BASE_URL;
  if (anyProvider && base === undefined) {
    issue(
      'OAUTH_REDIRECT_BASE_URL',
      'OAUTH_REDIRECT_BASE_URL es obligatoria si hay algún proveedor configurado.',
    );
  }
  if (typeof base === 'string' && URL.canParse(base)) {
    const url = new URL(base);
    if (url.origin !== base) {
      issue(
        'OAUTH_REDIRECT_BASE_URL',
        'OAUTH_REDIRECT_BASE_URL debe ser solo el origen de la web: sin ruta, sin barra final y sin consulta.',
      );
    } else if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackUrl(base))) {
      issue(
        'OAUTH_REDIRECT_BASE_URL',
        'OAUTH_REDIRECT_BASE_URL debe usar https: (o http: en loopback).',
      );
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
    // Inicio de sesión con terceros (§10.4). Un proveedor solo se activa con su pareja completa.
    OAUTH_REDIRECT_BASE_URL: optional(z.url({ protocol: /^https?$/ })),
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
  .superRefine(checkOAuth);

export type Env = z.infer<typeof envSchema>;
