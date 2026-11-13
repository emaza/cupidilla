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

/** Variables de entorno de la API. Si alguna no es válida, la API no arranca. */
export const envSchema = z.object({
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
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  RATE_LIMIT_FACTOR: z.coerce.number().int().min(1).max(1000).default(1),
  LOG_FORMAT: z.enum(['pretty', 'json']).default('pretty'),
});

export type Env = z.infer<typeof envSchema>;
