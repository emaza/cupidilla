import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashOpaqueToken } from '../src/common/crypto/opaque-token.js';
import {
  api,
  countRows,
  createTestApp,
  registerUser,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

/** Esquema de la migración 0001_oauth_identities (§5 del diseño de entrada con terceros). */
describe('Esquema de identidades y estado temporal de OAuth (§5)', () => {
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

  const HASH_A = 'a'.repeat(64);
  const HASH_B = 'b'.repeat(64);
  const LATER = '2026-11-11T10:10:00.000Z';

  /** La sentencia falla por esa restricción (`code` de PostgreSQL y nombre). */
  async function expectViolation(query: SQL, code: string, constraint: string): Promise<void> {
    await expect(t.db.execute(query)).rejects.toMatchObject({ cause: { code, constraint } });
  }
  const check = (query: SQL, constraint: string) => expectViolation(query, '23514', constraint);

  const insertIdentity = (userId: string, provider: string, subject: string) => sql`
    insert into identities (user_id, provider, subject, provider_email, email_verified)
    values (${userId}, ${provider}, ${subject}, 'ana@example.com', true)`;

  const insertOAuthState = (fields: {
    tokenHash?: string;
    purpose?: string;
    entryPoint?: string | null;
    sessionTokenHash?: string | null;
    returnPath?: string | null;
    provider?: string;
    connectProvider?: string | null;
    newPasswordHash?: string | null;
  }) => sql`
    insert into oauth_states (token_hash, provider, purpose, entry_point, session_token_hash,
      state, code_verifier, nonce, return_path, connect_provider, new_password_hash, created_at,
      expires_at)
    values (${fields.tokenHash ?? HASH_A}, ${fields.provider ?? 'google'},
      ${fields.purpose ?? 'sign_in'},
      ${fields.entryPoint === undefined ? 'login' : fields.entryPoint},
      ${fields.sessionTokenHash ?? null}, 's', 'v', 'n', ${fields.returnPath ?? null},
      ${fields.connectProvider ?? null}, ${fields.newPasswordHash ?? null}, ${TEST_NOW}, ${LATER})`;

  const insertPending = (fields: {
    tokenHash?: string;
    kind?: string;
    userId?: string | null;
    failedAttempts?: number;
    entryPoint?: string;
  }) => sql`
    insert into pending_identities (token_hash, kind, provider, subject, provider_email,
      email_verified, user_id, entry_point, failed_attempts, created_at, expires_at)
    values (${fields.tokenHash ?? HASH_A}, ${fields.kind ?? 'signup'}, 'google', 'sub-1',
      'ana@example.com', true, ${fields.userId ?? null}, ${fields.entryPoint ?? 'register'},
      ${fields.failedAttempts ?? 0}, ${TEST_NOW}, ${LATER})`;

  it('\\d: las restricciones con nombre de las tres tablas nuevas', async () => {
    const result = await t.db.execute<{
      table_name: string;
      conname: string;
      contype: string;
      definition: string;
    }>(sql`
      select conrelid::regclass::text as table_name, conname, contype,
             pg_get_constraintdef(oid) as definition
      from pg_constraint
      where connamespace = 'public'::regnamespace
        and conrelid::regclass::text in ('identities', 'oauth_states', 'pending_identities')
      order by 1, 2`);
    const byName = Object.fromEntries(result.rows.map((row) => [row.conname, row]));

    expect(byName.identities_provider_subject_unique).toMatchObject({
      contype: 'u',
      definition: 'UNIQUE (provider, subject)',
    });
    expect(byName.identities_user_provider_unique).toMatchObject({
      contype: 'u',
      definition: 'UNIQUE (user_id, provider)',
    });
    expect(byName.identities_user_id_users_id_fk?.definition).toBe(
      'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
    );
    expect(byName.pending_identities_user_id_users_id_fk?.definition).toBe(
      'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
    );
    expect(byName.oauth_states_session_token_hash_sessions_token_hash_fk?.definition).toBe(
      'FOREIGN KEY (session_token_hash) REFERENCES sessions(token_hash) ON DELETE CASCADE',
    );

    const checks = result.rows.filter((row) => row.contype === 'c').map((row) => row.conname);
    expect(checks).toEqual([
      'identities_provider_known',
      'identities_subject_length',
      'oauth_states_connect_provider_known',
      'oauth_states_connect_provider_shape',
      'oauth_states_entry_point_known',
      'oauth_states_new_password_hash_shape',
      'oauth_states_provider_known',
      'oauth_states_purpose_known',
      'oauth_states_purpose_shape',
      'oauth_states_return_path_length',
      'oauth_states_token_hash_format',
      'pending_identities_entry_point_known',
      'pending_identities_failed_attempts_range',
      'pending_identities_kind_known',
      'pending_identities_kind_shape',
      'pending_identities_provider_known',
      'pending_identities_return_path_length',
      'pending_identities_subject_length',
      'pending_identities_token_hash_format',
    ]);
  });

  it('toda FK hacia users borra en cascada', async () => {
    const result = await t.db.execute<{ table_name: string; confdeltype: string }>(sql`
      select conrelid::regclass::text as table_name, confdeltype
      from pg_constraint
      where contype = 'f' and confrelid = 'public.users'::regclass
      order by 1`);
    expect(result.rows).toEqual([
      { table_name: 'consents', confdeltype: 'c' },
      { table_name: 'identities', confdeltype: 'c' },
      { table_name: 'pending_identities', confdeltype: 'c' },
      { table_name: 'sessions', confdeltype: 'c' },
    ]);
  });

  it('users.password_hash admite NULL y sessions.authenticated_at no, y no tiene DEFAULT', async () => {
    const result = await t.db.execute<{
      table_name: string;
      column_name: string;
      is_nullable: string;
      column_default: string | null;
    }>(sql`
      select table_name, column_name, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public'
        and (table_name, column_name) in (('users', 'password_hash'), ('sessions', 'authenticated_at'))
      order by 1`);
    expect(result.rows).toEqual([
      {
        table_name: 'sessions',
        column_name: 'authenticated_at',
        is_nullable: 'NO',
        column_default: null,
      },
      {
        table_name: 'users',
        column_name: 'password_hash',
        is_nullable: 'YES',
        column_default: null,
      },
    ]);
  });

  it('identities: proveedor conocido, subject de 1 a 255, una cuenta por identidad y un proveedor de cada', async () => {
    const ana = await registerUser(t.app);
    const eva = await registerUser(t.app);
    await t.db.execute(insertIdentity(ana.userId, 'google', 'sub-1'));

    await check(insertIdentity(ana.userId, 'github', 'sub-2'), 'identities_provider_known');
    await check(insertIdentity(ana.userId, 'facebook', ''), 'identities_subject_length');
    await check(
      insertIdentity(ana.userId, 'facebook', 'x'.repeat(256)),
      'identities_subject_length',
    );
    await expectViolation(
      insertIdentity(eva.userId, 'google', 'sub-1'),
      '23505',
      'identities_provider_subject_unique',
    );
    await expectViolation(
      insertIdentity(ana.userId, 'google', 'sub-3'),
      '23505',
      'identities_user_provider_unique',
    );
    // El mismo subject en otro proveedor es otra identidad.
    await t.db.execute(insertIdentity(eva.userId, 'facebook', 'sub-1'));
    await t.db.execute(insertIdentity(ana.userId, 'facebook', 'x'.repeat(255)));
    expect(await countRows(t.db, 'identities')).toBe(3);
  });

  it('oauth_states: forma según el propósito, valores conocidos y return_path de 64 como mucho', async () => {
    const user = await registerUser(t.app);
    const sessionHash = hashOpaqueToken(user.token);

    await t.db.execute(insertOAuthState({ tokenHash: HASH_A }));
    await t.db.execute(
      insertOAuthState({
        tokenHash: HASH_B,
        purpose: 'connect',
        entryPoint: null,
        sessionTokenHash: sessionHash,
        returnPath: `/${'a'.repeat(63)}`,
      }),
    );

    const other = 'c'.repeat(64);
    await check(insertOAuthState({ tokenHash: 'A'.repeat(64) }), 'oauth_states_token_hash_format');
    await check(
      insertOAuthState({ tokenHash: other, provider: 'x' }),
      'oauth_states_provider_known',
    );
    await check(insertOAuthState({ tokenHash: other, purpose: 'x' }), 'oauth_states_purpose_known');
    await check(
      insertOAuthState({ tokenHash: other, entryPoint: 'account' }),
      'oauth_states_entry_point_known',
    );
    await check(
      insertOAuthState({ tokenHash: other, returnPath: `/${'a'.repeat(64)}` }),
      'oauth_states_return_path_length',
    );
    // sign_in sin pantalla de origen, o con sesión; reauthenticate sin sesión, o con pantalla.
    await check(
      insertOAuthState({ tokenHash: other, entryPoint: null }),
      'oauth_states_purpose_shape',
    );
    await check(
      insertOAuthState({ tokenHash: other, sessionTokenHash: sessionHash }),
      'oauth_states_purpose_shape',
    );
    await check(
      insertOAuthState({ tokenHash: other, purpose: 'reauthenticate', entryPoint: null }),
      'oauth_states_purpose_shape',
    );
    await check(
      insertOAuthState({
        tokenHash: other,
        purpose: 'reauthenticate',
        entryPoint: 'login',
        sessionTokenHash: sessionHash,
      }),
      'oauth_states_purpose_shape',
    );
    await expectViolation(
      insertOAuthState({
        tokenHash: other,
        purpose: 'connect',
        entryPoint: null,
        sessionTokenHash: 'd'.repeat(64),
      }),
      '23503',
      'oauth_states_session_token_hash_sessions_token_hash_fk',
    );
    expect(await countRows(t.db, 'oauth_states')).toBe(2);
  });

  it('C11: connect_provider y new_password_hash solo en una reautenticación (decisión 21)', async () => {
    const user = await registerUser(t.app);
    const sessionHash = hashOpaqueToken(user.token);
    const reauth = { purpose: 'reauthenticate', entryPoint: null, sessionTokenHash: sessionHash };

    await t.db.execute(
      insertOAuthState({
        ...reauth,
        tokenHash: HASH_A,
        provider: 'facebook',
        connectProvider: 'google',
      }),
    );
    await t.db.execute(insertOAuthState({ ...reauth, tokenHash: HASH_B, newPasswordHash: 'h' }));

    const other = 'c'.repeat(64);
    await check(
      insertOAuthState({ ...reauth, tokenHash: other, connectProvider: 'github' }),
      'oauth_states_connect_provider_known',
    );
    // Con purpose connect, o igual al proveedor que confirma.
    await check(
      insertOAuthState({
        tokenHash: other,
        purpose: 'connect',
        entryPoint: null,
        sessionTokenHash: sessionHash,
        provider: 'google',
        connectProvider: 'facebook',
      }),
      'oauth_states_connect_provider_shape',
    );
    await check(
      insertOAuthState({
        ...reauth,
        tokenHash: other,
        provider: 'google',
        connectProvider: 'google',
      }),
      'oauth_states_connect_provider_shape',
    );
    await check(
      insertOAuthState({
        tokenHash: other,
        purpose: 'connect',
        entryPoint: null,
        sessionTokenHash: sessionHash,
        newPasswordHash: 'h',
      }),
      'oauth_states_new_password_hash_shape',
    );
    await check(
      insertOAuthState({ tokenHash: other, newPasswordHash: 'h' }),
      'oauth_states_new_password_hash_shape',
    );
    await check(
      insertOAuthState({
        ...reauth,
        tokenHash: other,
        provider: 'facebook',
        connectProvider: 'google',
        newPasswordHash: 'h',
      }),
      'oauth_states_new_password_hash_shape',
    );
    expect(await countRows(t.db, 'oauth_states')).toBe(2);
  });

  it('cambio 3: índice de expresión lower(btrim(provider_email)) en identities', async () => {
    const result = await t.db.execute<{ indexdef: string }>(sql`
      select indexdef from pg_indexes
      where schemaname = 'public' and indexname = 'identities_provider_email_normalized_idx'`);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.indexdef).toBe(
      'CREATE INDEX identities_provider_email_normalized_idx ON public.identities USING btree (lower(btrim(provider_email)))',
    );
  });

  it('pending_identities: link lleva cuenta y signup no; tope de 5 fallos', async () => {
    const user = await registerUser(t.app);
    await t.db.execute(insertPending({ tokenHash: HASH_A }));
    await t.db.execute(
      insertPending({ tokenHash: HASH_B, kind: 'link', userId: user.userId, failedAttempts: 5 }),
    );

    const other = 'c'.repeat(64);
    await check(insertPending({ tokenHash: other, kind: 'link' }), 'pending_identities_kind_shape');
    await check(
      insertPending({ tokenHash: other, userId: user.userId }),
      'pending_identities_kind_shape',
    );
    await check(insertPending({ tokenHash: other, kind: 'x' }), 'pending_identities_kind_known');
    await check(
      insertPending({ tokenHash: other, failedAttempts: 6 }),
      'pending_identities_failed_attempts_range',
    );
    await check(
      insertPending({ tokenHash: other, failedAttempts: -1 }),
      'pending_identities_failed_attempts_range',
    );
    await check(
      insertPending({ tokenHash: other, entryPoint: 'account' }),
      'pending_identities_entry_point_known',
    );
    await check(insertPending({ tokenHash: 'x' }), 'pending_identities_token_hash_format');
    expect(await countRows(t.db, 'pending_identities')).toBe(2);
  });

  it('borrar la cuenta arrastra identidades y pendientes; cerrar la sesión, su oauth_states', async () => {
    const user = await registerUser(t.app);
    const sessionHash = hashOpaqueToken(user.token);
    await t.db.execute(insertIdentity(user.userId, 'google', 'sub-1'));
    await t.db.execute(insertPending({ tokenHash: HASH_A, kind: 'link', userId: user.userId }));
    await t.db.execute(
      insertOAuthState({
        tokenHash: HASH_B,
        purpose: 'reauthenticate',
        entryPoint: null,
        sessionTokenHash: sessionHash,
      }),
    );

    const logout = await api(t.app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${user.token}`);
    expect(logout.status).toBe(204);
    expect(await countRows(t.db, 'oauth_states')).toBe(0);

    await t.db.execute(sql`delete from users where id = ${user.userId}`);
    expect(await countRows(t.db, 'identities')).toBe(0);
    expect(await countRows(t.db, 'pending_identities')).toBe(0);
  });
});
