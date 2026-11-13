import { eq, sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashOpaqueToken } from '../src/common/crypto/opaque-token.js';
import { sessions, users } from '../src/database/schema/index.js';
import {
  api,
  countRows,
  createTestApp,
  registerUser,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

/** QA de la fase 1 de «Login con terceros»: login sin contraseña, borrado y restricciones. */
describe('QA fase 1: login con password_hash nulo', () => {
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

  const login = (email: string, password: string) =>
    api(t.app).post('/auth/login').send({ email, password });
  const withoutPassword = (userId: string) =>
    t.db.update(users).set({ passwordHash: null }).where(eq(users.id, userId));

  /** Cabeceras que no dependen de la petición concreta (ni de cuántos intentos lleva ya el correo). */
  const VOLATILE_HEADERS = ['date', 'x-request-id', 'retry-after', 'x-ratelimit-remaining-account'];
  const stableHeaders = (headers: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(headers).filter(([name]) => !VOLATILE_HEADERS.includes(name)),
    );

  it('mismo estado, cuerpo y cabeceras que un correo inexistente y que una contraseña errónea; no crea sesión', async () => {
    const withHash = await registerUser(t.app);
    const noHash = await registerUser(t.app);
    await withoutPassword(noHash.userId);
    const sessionsBefore = await countRows(t.db, 'sessions');

    const unknown = await login('nadie@example.com', 'contraseña-segura-1');
    const wrong = await login(withHash.email, 'contraseña-errónea-1');
    const passwordless = await login(noHash.email, noHash.password);
    // También con la contraseña "correcta" que tenía antes, y con una vacía de significado.
    const passwordlessBlank = await login(noHash.email, ' ');

    for (const response of [unknown, wrong, passwordless, passwordlessBlank]) {
      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' },
      });
      expect(stableHeaders(response.headers)).toEqual(stableHeaders(unknown.headers));
      expect(response.headers['set-cookie']).toBeUndefined();
    }
    expect(await countRows(t.db, 'sessions')).toBe(sessionsBefore);
  });

  it('el tiempo de la cuenta sin contraseña se parece al de una contraseña errónea (argon2 se calcula)', async () => {
    const withHash = await registerUser(t.app);
    const noHash = await registerUser(t.app);
    await withoutPassword(noHash.userId);

    const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]!;
    const time = async (email: string): Promise<number> => {
      const start = performance.now();
      const response = await login(email, 'contraseña-errónea-1');
      const elapsed = performance.now() - start;
      expect(response.status).toBe(401);
      return elapsed;
    };

    // Cuatro intentos por correo: queda por debajo del tope de 5 por correo y 15 minutos.
    const timings = { hash: [] as number[], none: [] as number[], unknown: [] as number[] };
    await time(withHash.email); // calentamiento
    for (let i = 0; i < 4; i++) {
      timings.hash.push(await time(withHash.email));
      timings.none.push(await time(noHash.email));
      timings.unknown.push(await time(`desconocido+${i}@example.com`));
    }
    const hash = median(timings.hash);
    const none = median(timings.none);
    const unknown = median(timings.unknown);
    // Sin argon2 una respuesta tardaría ~1 ms frente a ~50-200 ms: la diferencia sería enorme.
    expect(hash).toBeGreaterThan(20);
    expect(none).toBeGreaterThan(hash * 0.5);
    expect(none).toBeLessThan(hash * 2);
    expect(unknown).toBeGreaterThan(hash * 0.5);
    expect(unknown).toBeLessThan(hash * 2);
  });

  it('comparte el límite por correo con el resto de los logins: el 6.º → 429 igual que con contraseña', async () => {
    const noHash = await registerUser(t.app);
    await withoutPassword(noHash.userId);
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect((await login(noHash.email, 'x')).status).toBe(401);
    }
    const blocked = await login(` ${noHash.email.toUpperCase()} `, noHash.password);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('el login normal sigue igual: devuelve sesión con authenticated_at = created_at y no toca el hash', async () => {
    const user = await registerUser(t.app);
    const [before] = await t.db.select().from(users).where(eq(users.id, user.userId));
    t.clock.set('2026-11-11T11:30:00.000Z');
    const response = await login(user.email.toUpperCase(), user.password);
    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(user.email);
    const [row] = await t.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, hashOpaqueToken(response.body.session.token as string)));
    expect(row?.authenticatedAt.toISOString()).toBe('2026-11-11T11:30:00.000Z');
    expect(row?.createdAt.toISOString()).toBe('2026-11-11T11:30:00.000Z');
    // La sesión es de esta persona, no solo una sesión con la fecha correcta.
    expect(row?.userId).toBe(user.userId);
    const [after] = await t.db.select().from(users).where(eq(users.id, user.userId));
    expect(after?.passwordHash).toBe(before?.passwordHash);

    // La sesión del registro conserva su fecha: otro login no la modifica.
    const old = await api(t.app).get('/users/me').set('Authorization', `Bearer ${user.token}`);
    expect(old.body.session.authenticatedAt).toBe(TEST_NOW);
  });

  it('una cuenta sin contraseña conserva su sesión y /users/me, y su correo sigue ocupado en el registro', async () => {
    const user = await registerUser(t.app);
    await withoutPassword(user.userId);
    const account = await api(t.app).get('/users/me').set('Authorization', `Bearer ${user.token}`);
    expect(account.status).toBe(200);
    expect(account.body.signInMethods.password).toBe(false);

    const again = await api(t.app).post('/auth/register').send({
      email: user.email,
      password: 'otra-contraseña-larga',
      birthDate: '1990-05-05',
      acceptTerms: true,
      termsVersion: user.termsVersion,
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('EMAIL_TAKEN');
    const [row] = await t.db.select().from(users).where(eq(users.id, user.userId));
    expect(row?.passwordHash).toBeNull();
  });

  it('cuenta sin hash: el borrado no pide contraseña ni sesión reciente y una contraseña en el cuerpo no cambia nada (decisión 20)', async () => {
    const user = await registerUser(t.app);
    await withoutPassword(user.userId);
    t.clock.set(new Date(new Date(TEST_NOW).getTime() + 11 * 60_000));
    const response = await api(t.app)
      .post('/users/me/deletion')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ password: 'cualquiera' });
    expect(response.status).toBe(204);
    expect(await countRows(t.db, 'users')).toBe(0);
    expect(await countRows(t.db, 'sessions')).toBe(0);
  });
});

describe('QA fase 1: borrado de la cuenta y restricciones del esquema', () => {
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
  const HASH_C = 'c'.repeat(64);
  const HASH_D = 'd'.repeat(64);
  const LATER = '2026-11-11T10:10:00.000Z';

  const insertIdentity = (userId: string, provider: string, subject: string) =>
    t.db.execute(sql`
      insert into identities (user_id, provider, subject, provider_email, email_verified)
      values (${userId}, ${provider}, ${subject}, 'x@example.com', true)`);
  const insertState = (tokenHash: string, sessionToken: string | null) =>
    t.db.execute(sql`
      insert into oauth_states (token_hash, provider, purpose, entry_point, session_token_hash,
        state, code_verifier, nonce, created_at, expires_at)
      values (${tokenHash}, 'google', ${sessionToken ? 'reauthenticate' : 'sign_in'},
        ${sessionToken ? null : 'login'}, ${sessionToken}, 's', 'v', 'n', ${TEST_NOW}, ${LATER})`);
  const insertPending = (tokenHash: string, userId: string | null) =>
    t.db.execute(sql`
      insert into pending_identities (token_hash, kind, provider, subject, provider_email,
        email_verified, user_id, entry_point, created_at, expires_at)
      values (${tokenHash}, ${userId ? 'link' : 'signup'}, 'facebook', 'fb-1', 'x@example.com',
        true, ${userId}, 'login', ${TEST_NOW}, ${LATER})`);

  async function countWhere(table: string, condition: SQL): Promise<number> {
    const result = await t.db.execute<{ count: string }>(
      sql`select count(*)::text as count from ${sql.identifier(table)} where ${condition}`,
    );
    return Number(result.rows[0]?.count);
  }

  it('POST /users/me/deletion elimina identidades, pendientes y oauth_states de esa cuenta y deja intactos los de otra', async () => {
    const ana = await registerUser(t.app);
    const eva = await registerUser(t.app);
    const anaSession = hashOpaqueToken(ana.token);
    const evaSession = hashOpaqueToken(eva.token);

    await insertIdentity(ana.userId, 'google', 'g-ana');
    await insertIdentity(ana.userId, 'facebook', 'f-ana');
    await insertIdentity(eva.userId, 'google', 'g-eva');
    await insertPending(HASH_A, ana.userId); // unión pendiente de Ana
    await insertPending(HASH_B, eva.userId);
    await insertPending(HASH_C, null); // alta pendiente de nadie en concreto: no cuelga de users
    await insertState(HASH_D, anaSession); // reautenticación de la sesión de Ana
    await insertState('e'.repeat(64), evaSession);
    await insertState('f'.repeat(64), null); // entrada sin sesión: tampoco cuelga de nadie

    const deleted = await api(t.app)
      .post('/users/me/deletion')
      .set('Authorization', `Bearer ${ana.token}`)
      .send({ password: ana.password });
    expect(deleted.status).toBe(204);

    expect(await countWhere('users', sql`id = ${ana.userId}`)).toBe(0);
    expect(await countWhere('identities', sql`user_id = ${ana.userId}`)).toBe(0);
    expect(await countWhere('pending_identities', sql`user_id = ${ana.userId}`)).toBe(0);
    expect(await countWhere('oauth_states', sql`session_token_hash = ${anaSession}`)).toBe(0);
    expect(await countWhere('sessions', sql`user_id = ${ana.userId}`)).toBe(0);
    // Lo ajeno sigue ahí.
    expect(await countRows(t.db, 'identities')).toBe(1);
    expect(await countRows(t.db, 'pending_identities')).toBe(2);
    expect(await countRows(t.db, 'oauth_states')).toBe(2);
    expect(await countWhere('users', sql`id = ${eva.userId}`)).toBe(1);
  });

  it('un borrado con contraseña errónea no toca identidades ni estado temporal', async () => {
    const ana = await registerUser(t.app);
    await insertIdentity(ana.userId, 'google', 'g-ana');
    await insertPending(HASH_A, ana.userId);
    await insertState(HASH_B, hashOpaqueToken(ana.token));

    const response = await api(t.app)
      .post('/users/me/deletion')
      .set('Authorization', `Bearer ${ana.token}`)
      .send({ password: 'contraseña-errónea' });
    expect(response.status).toBe(403);
    expect(await countRows(t.db, 'identities')).toBe(1);
    expect(await countRows(t.db, 'pending_identities')).toBe(1);
    expect(await countRows(t.db, 'oauth_states')).toBe(1);
  });

  it('una sesión caducada que se valida se borra y arrastra su oauth_states', async () => {
    const ana = await registerUser(t.app);
    await insertState(HASH_A, hashOpaqueToken(ana.token));
    t.clock.advanceDays(31);
    const response = await api(t.app)
      .get('/auth/session')
      .set('Authorization', `Bearer ${ana.token}`);
    expect(response.status).toBe(401);
    expect(await countRows(t.db, 'sessions')).toBe(0);
    expect(await countRows(t.db, 'oauth_states')).toBe(0);
  });

  it('el login borra las sesiones caducadas del usuario y con ellas su oauth_states', async () => {
    const ana = await registerUser(t.app);
    await insertState(HASH_A, hashOpaqueToken(ana.token));
    t.clock.advanceDays(31);
    const response = await api(t.app)
      .post('/auth/login')
      .send({ email: ana.email, password: ana.password });
    expect(response.status).toBe(200);
    expect(await countRows(t.db, 'sessions')).toBe(1);
    expect(await countRows(t.db, 'oauth_states')).toBe(0);
  });

  const violation = async (query: ReturnType<typeof insertIdentity>, code: string) => {
    await expect(query).rejects.toMatchObject({ cause: { code } });
  };

  it('token_hash con salto de línea final o en mayúsculas no pasa la CHECK', async () => {
    await violation(insertState(`${HASH_A}\n`, null), '23514');
    await violation(insertState(`${HASH_A.slice(1)}\n`, null), '23514');
    await violation(insertState(' ' + HASH_A.slice(1), null), '23514');
    await violation(insertState('A'.repeat(64), null), '23514');
    await violation(insertPending(`${HASH_A}\n`, null), '23514');
    expect(await countRows(t.db, 'oauth_states')).toBe(0);
    expect(await countRows(t.db, 'pending_identities')).toBe(0);
  });

  it('el proveedor distingue mayúsculas y no admite nulos; la unión exige una cuenta que exista', async () => {
    const ana = await registerUser(t.app);
    await violation(insertIdentity(ana.userId, 'Google', 'x'), '23514');
    await violation(insertIdentity(ana.userId, 'google ', 'x'), '23514');
    await violation(
      t.db.execute(sql`insert into identities (user_id, provider, subject, email_verified)
        values (${ana.userId}, NULL, 'x', true)`),
      '23502',
    );
    await violation(
      t.db.execute(sql`insert into identities (user_id, provider, subject)
        values (${ana.userId}, 'google', 'x')`),
      '23502',
    );
    // kind = 'link' con un user_id inexistente: FK.
    await violation(insertPending(HASH_A, '00000000-0000-4000-8000-000000000000'), '23503');
    // Un subject de 255 caracteres multibyte (más de 255 bytes) es válido: se mide en caracteres.
    await insertIdentity(ana.userId, 'google', 'ñ'.repeat(255));
    expect(await countRows(t.db, 'identities')).toBe(1);
  });

  it('borrar la sesión (logout) no borra la cuenta ni sus identidades, solo su oauth_states', async () => {
    const ana = await registerUser(t.app);
    await insertIdentity(ana.userId, 'google', 'g-ana');
    await insertPending(HASH_A, ana.userId);
    await insertState(HASH_B, hashOpaqueToken(ana.token));
    const response = await api(t.app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${ana.token}`);
    expect(response.status).toBe(204);
    expect(await countRows(t.db, 'users')).toBe(1);
    expect(await countRows(t.db, 'identities')).toBe(1);
    expect(await countRows(t.db, 'pending_identities')).toBe(1);
    expect(await countRows(t.db, 'oauth_states')).toBe(0);
  });
});
