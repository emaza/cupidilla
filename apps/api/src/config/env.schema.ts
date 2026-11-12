import { z } from 'zod';

/** Variables de entorno de la API. Si alguna no es válida, la API no arranca. */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
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
