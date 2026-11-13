import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sessions } from './sessions.js';

/**
 * Flujo con un proveedor en curso (§5.3): una fila por clic, de un solo uso y 10 minutos.
 * `state` y `code_verifier` van en claro: duran poco y no sirven sin el código del proveedor.
 */
export const oauthStates = pgTable(
  'oauth_states',
  {
    // SHA-256 del flowToken de la cookie `cupidilla_oauth`, como en sessions.
    tokenHash: text('token_hash').primaryKey(),
    provider: text('provider', { enum: ['google', 'facebook'] }).notNull(),
    purpose: text('purpose', { enum: ['sign_in', 'reauthenticate', 'connect'] }).notNull(),
    entryPoint: text('entry_point', { enum: ['login', 'register'] }),
    // Con reauthenticate y connect, la sesión que empezó el flujo. Cerrarla borra la fila.
    sessionTokenHash: text('session_token_hash').references(() => sessions.tokenHash, {
      onDelete: 'cascade',
    }),
    state: text('state').notNull(),
    codeVerifier: text('code_verifier').notNull(),
    // En Facebook se genera igual y no se usa.
    nonce: text('nonce').notNull(),
    returnPath: text('return_path'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('oauth_states_expires_at_idx').on(t.expiresAt),
    check('oauth_states_token_hash_format', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check('oauth_states_provider_known', sql`${t.provider} in ('google', 'facebook')`),
    check(
      'oauth_states_purpose_known',
      sql`${t.purpose} in ('sign_in', 'reauthenticate', 'connect')`,
    ),
    check('oauth_states_entry_point_known', sql`${t.entryPoint} in ('login', 'register')`),
    check('oauth_states_return_path_length', sql`char_length(${t.returnPath}) <= 64`),
    // sign_in lleva pantalla de origen y ninguna sesión; los demás, sesión y ninguna pantalla.
    // Son dos igualdades: la forma `(purpose = 'sign_in') = (entry_point is not null and
    // session_token_hash is null)` de §5.3 admitiría reauthenticate y connect sin sesión.
    check(
      'oauth_states_purpose_shape',
      sql`(${t.purpose} = 'sign_in') = (${t.entryPoint} is not null) and (${t.purpose} = 'sign_in') = (${t.sessionTokenHash} is null)`,
    ),
  ],
);
