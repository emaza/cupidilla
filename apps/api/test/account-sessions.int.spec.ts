import { ACCOUNT_SESSIONS_LIMIT, accountResponseSchema } from '@cupidilla/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateOpaqueToken, hashOpaqueToken } from '../src/common/crypto/opaque-token.js';
import { identities, sessions, users } from '../src/database/schema/index.js';
import {
  api,
  createTestApp,
  registerUser,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const at = (base: string, ms: number): Date => new Date(new Date(base).getTime() + ms);

describe('GET /users/me: sesiones abiertas y último uso de los proveedores', () => {
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

  const getAccount = (token: string) =>
    api(t.app).get('/users/me').set('Authorization', `Bearer ${token}`);

  async function login(email: string, password: string): Promise<string> {
    const response = await api(t.app).post('/auth/login').send({ email, password });
    expect(response.status).toBe(200);
    return response.body.session.token as string;
  }

  /** Inserta una sesión directamente en la base; devuelve su token. */
  async function insertSession(
    userId: string,
    data: { createdAt: Date; expiresAt: Date; authenticatedAt?: Date },
  ): Promise<string> {
    const token = generateOpaqueToken();
    await t.db.insert(sessions).values({
      tokenHash: hashOpaqueToken(token),
      userId,
      createdAt: data.createdAt,
      authenticatedAt: data.authenticatedAt ?? data.createdAt,
      expiresAt: data.expiresAt,
    });
    return token;
  }

  it('AS-1: devuelve las sesiones abiertas con su forma y valida contra el contrato', async () => {
    const user = await registerUser(t.app);
    const response = await getAccount(user.token);
    expect(response.status).toBe(200);
    expect(accountResponseSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.sessions).toEqual([
      {
        createdAt: TEST_NOW,
        authenticatedAt: TEST_NOW,
        expiresAt: at(TEST_NOW, 30 * DAY_MS).toISOString(),
        current: true,
      },
    ]);
  });

  it('AS-2: primero la actual, después de la más nueva a la más antigua; solo una es la actual', async () => {
    const user = await registerUser(t.app);
    t.clock.advanceMinutes(60);
    const second = await login(user.email, user.password);
    t.clock.advanceMinutes(60);
    const third = await login(user.email, user.password);

    const created = {
      [user.token]: TEST_NOW,
      [second]: at(TEST_NOW, 60 * MINUTE_MS).toISOString(),
      [third]: at(TEST_NOW, 120 * MINUTE_MS).toISOString(),
    };
    const expectedOrder: Record<string, string[]> = {
      [user.token]: [user.token, third, second],
      [second]: [second, third, user.token],
      [third]: [third, second, user.token],
    };

    for (const token of [user.token, second, third]) {
      const response = await getAccount(token);
      expect(response.status).toBe(200);
      const list = response.body.sessions as { createdAt: string; current: boolean }[];
      expect(list.map((item) => item.createdAt)).toEqual(
        expectedOrder[token]!.map((item) => created[item]),
      );
      expect(list.map((item) => item.current)).toEqual([true, false, false]);
    }
  });

  it('AS-3: las caducadas no aparecen pero siguen en la base (también con expires_at == now)', async () => {
    const user = await registerUser(t.app);
    const now = t.clock.now();
    await insertSession(user.userId, { createdAt: at(TEST_NOW, -40 * DAY_MS), expiresAt: now });
    await insertSession(user.userId, {
      createdAt: at(TEST_NOW, -31 * DAY_MS),
      expiresAt: at(TEST_NOW, -DAY_MS),
    });
    await insertSession(user.userId, {
      createdAt: at(TEST_NOW, -29 * DAY_MS),
      expiresAt: at(TEST_NOW, 1),
    });

    const response = await getAccount(user.token);
    expect(response.status).toBe(200);
    expect(response.body.sessions).toHaveLength(2);
    expect(response.body.sessions[1]).toEqual({
      createdAt: at(TEST_NOW, -29 * DAY_MS).toISOString(),
      authenticatedAt: at(TEST_NOW, -29 * DAY_MS).toISOString(),
      expiresAt: at(TEST_NOW, 1).toISOString(),
      current: false,
    });

    const rows = await t.db.select().from(sessions).where(eq(sessions.userId, user.userId));
    expect(rows).toHaveLength(4);
  });

  it('AS-4: cada usuario ve solo sus sesiones', async () => {
    const ana = await registerUser(t.app);
    const beto = await registerUser(t.app);
    t.clock.advanceMinutes(1);
    await login(beto.email, beto.password);

    const anaList = (await getAccount(ana.token)).body.sessions;
    const betoList = (await getAccount(beto.token)).body.sessions;
    expect(anaList).toHaveLength(1);
    expect(betoList).toHaveLength(2);
    expect(anaList[0].current).toBe(true);
  });

  it('AS-5: con 26 sesiones devuelve 20 y la actual va primera aunque sea la más antigua', async () => {
    const user = await registerUser(t.app);
    for (let i = 1; i <= 25; i += 1) {
      await insertSession(user.userId, {
        createdAt: at(TEST_NOW, i * MINUTE_MS),
        expiresAt: at(TEST_NOW, 30 * DAY_MS),
      });
    }

    const response = await getAccount(user.token);
    expect(response.status).toBe(200);
    expect(accountResponseSchema.safeParse(response.body).success).toBe(true);
    const list = response.body.sessions as { createdAt: string; current: boolean }[];
    expect(list).toHaveLength(ACCOUNT_SESSIONS_LIMIT);
    expect(list[0]).toMatchObject({ createdAt: TEST_NOW, current: true });
    // Después, las 19 más nuevas: de la 25 a la 7.
    expect(list.slice(1).map((item) => item.createdAt)).toEqual(
      Array.from({ length: 19 }, (_, index) =>
        at(TEST_NOW, (25 - index) * MINUTE_MS).toISOString(),
      ),
    );
    expect(list.filter((item) => item.current)).toHaveLength(1);
  });

  it('AS-6: tras la renovación, la sesión actual muestra la nueva caducidad (T+46 días)', async () => {
    const user = await registerUser(t.app);
    t.clock.advanceDays(16);
    const response = await getAccount(user.token);
    expect(response.status).toBe(200);
    expect(response.body.sessions).toEqual([
      {
        createdAt: TEST_NOW,
        authenticatedAt: TEST_NOW,
        expiresAt: at(TEST_NOW, 46 * DAY_MS).toISOString(),
        current: true,
      },
    ]);
  });

  it('AS-7: reautenticarse cambia authenticatedAt solo en la sesión actual', async () => {
    const user = await registerUser(t.app);
    t.clock.advanceMinutes(1);
    const other = await login(user.email, user.password);
    t.clock.advanceMinutes(30);
    const reauth = await api(t.app)
      .post('/users/me/reauthentication')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ password: user.password });
    expect(reauth.status).toBe(204);
    const reauthAt = t.clock.now().toISOString();

    const list = (await getAccount(user.token)).body.sessions;
    expect(list).toEqual([
      expect.objectContaining({ createdAt: TEST_NOW, authenticatedAt: reauthAt, current: true }),
      expect.objectContaining({
        createdAt: at(TEST_NOW, MINUTE_MS).toISOString(),
        authenticatedAt: at(TEST_NOW, MINUTE_MS).toISOString(),
        current: false,
      }),
    ]);
    const fromOther = (await getAccount(other)).body.session;
    expect(fromOther).toEqual({ authenticatedAt: at(TEST_NOW, MINUTE_MS).toISOString() });
  });

  it('AS-8: no sale nada sensible: ni tokens, ni hashes, ni datos del proveedor', async () => {
    const user = await registerUser(t.app);
    t.clock.advanceMinutes(1);
    const other = await login(user.email, user.password);
    const subject = 'sujeto-del-proveedor-1234567890';
    const providerEmail = 'correo.del.proveedor@example.com';
    await t.db.insert(identities).values({
      userId: user.userId,
      provider: 'google',
      subject,
      providerEmail,
      emailVerified: true,
      createdAt: t.clock.now(),
      lastUsedAt: t.clock.now(),
    });
    const [row] = await t.db.select().from(users).where(eq(users.id, user.userId));

    const response = await getAccount(user.token);
    expect(response.status).toBe(200);
    const text = response.text;
    for (const secret of [
      user.token,
      other,
      hashOpaqueToken(user.token),
      hashOpaqueToken(other),
      row!.passwordHash!,
      '$argon2',
      'password_hash',
      subject,
      providerEmail,
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toMatch(/[0-9a-f]{64}/i);

    const forbidden = ['token', 'tokenHash', 'passwordHash', 'subject', 'providerEmail', 'userId'];
    const keys = new Set<string>();
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') {
        for (const [key, inner] of Object.entries(value)) {
          keys.add(key);
          collect(inner);
        }
      }
    };
    collect(response.body);
    for (const key of forbidden) expect(keys.has(key), key).toBe(false);

    for (const item of response.body.sessions) {
      expect(Object.keys(item).sort()).toEqual([
        'authenticatedAt',
        'createdAt',
        'current',
        'expiresAt',
      ]);
    }
    for (const item of response.body.signInMethods.identities) {
      expect(Object.keys(item).sort()).toEqual(['lastUsedAt', 'linkedAt', 'provider']);
    }
  });

  it('AS-9: lastUsedAt de cada proveedor es el valor guardado, distinto de la fecha de unión', async () => {
    const user = await registerUser(t.app);
    const linkedAt = at(TEST_NOW, -10 * DAY_MS);
    const lastUsedAt = at(TEST_NOW, -2 * DAY_MS);
    await t.db.insert(identities).values({
      userId: user.userId,
      provider: 'facebook',
      subject: 'sujeto-facebook',
      providerEmail: null,
      emailVerified: false,
      createdAt: linkedAt,
      lastUsedAt,
    });

    const response = await getAccount(user.token);
    expect(response.status).toBe(200);
    expect(response.body.signInMethods.identities).toEqual([
      {
        provider: 'facebook',
        linkedAt: linkedAt.toISOString(),
        lastUsedAt: lastUsedAt.toISOString(),
      },
    ]);
  });
});
