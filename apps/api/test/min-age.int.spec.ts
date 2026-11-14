import { configResponseSchema } from '@cupidilla/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// La variable se lee al cargar el módulo de la aplicación: va antes que cualquier import.
vi.hoisted(() => {
  process.env.MIN_AGE = '21';
});

const { runFlow, signupBody } = await import('./helpers/oauth.js');
const { api, countRows, createTestApp, registerBody, truncateAll } =
  await import('./helpers/test-app.js');
type TestApp = Awaited<ReturnType<typeof createTestApp>>;

// Hoy en los tests es 2026-11-11 (TEST_NOW): quien nació el 2005-11-11 cumple 21 hoy.
const TURNS_21_TODAY = '2005-11-11';
const TURNS_21_TOMORROW = '2005-11-12';
const TABLES = ['users', 'identities', 'consents', 'sessions', 'pending_identities'];

describe('MIN_AGE=21', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await truncateAll(t.db);
  });

  it('GET /config devuelve { minAge: 21 }', async () => {
    const response = await api(t.app).get('/config');
    expect(response.status).toBe(200);
    expect(configResponseSchema.parse(response.body)).toEqual({ minAge: 21 });
  });

  it('registro con contraseña: 20 años → UNDERAGE sin guardar nada; 21 cumplidos hoy → 201', async () => {
    const underage = await api(t.app)
      .post('/auth/register')
      .send(registerBody({ birthDate: TURNS_21_TOMORROW }));
    expect(underage.status).toBe(422);
    expect(underage.body.error.code).toBe('UNDERAGE');
    for (const table of TABLES) expect(await countRows(t.db, table), table).toBe(0);

    const adult = await api(t.app)
      .post('/auth/register')
      .send(registerBody({ birthDate: TURNS_21_TODAY }));
    expect(adult.status).toBe(201);
  });

  it('alta con proveedor: 20 años → UNDERAGE sin guardar nada; 21 cumplidos hoy → 201', async () => {
    const signup = (body: Record<string, unknown>) =>
      api(t.app).post('/auth/oauth/signup').send(body);
    const pendingToken = async () => (await runFlow(t.app)).response.body.pending.token as string;

    const underage = await signup(
      signupBody(await pendingToken(), { birthDate: TURNS_21_TOMORROW }),
    );
    expect(underage.status).toBe(422);
    expect(underage.body.error.code).toBe('UNDERAGE');
    for (const table of TABLES) expect(await countRows(t.db, table), table).toBe(0);

    const adult = await signup(signupBody(await pendingToken(), { birthDate: TURNS_21_TODAY }));
    expect(adult.status).toBe(201);
  });
});
