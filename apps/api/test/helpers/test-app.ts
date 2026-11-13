import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { SERVICE_TERMS_VERSION, type RegisterRequest } from '@cupidilla/contracts';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { Clock } from '../../src/common/clock.js';
import { configureApp } from '../../src/configure-app.js';
import { DB, type Database } from '../../src/database/database.types.js';
import { FakeClock } from './fake-clock.js';

export const TEST_NOW = '2026-11-11T10:00:00.000Z';

export interface TestApp {
  app: NestExpressApplication;
  clock: FakeClock;
  db: Database;
}

/** App completa con `configureApp`, base de datos real y `Clock` falso. */
export async function createTestApp(options: { now?: string } = {}): Promise<TestApp> {
  const clock = new FakeClock(options.now ?? TEST_NOW);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return { app, clock, db: app.get<Database>(DB) };
}

/** Vacía todas las tablas del esquema public, consultadas dinámicamente. */
export async function truncateAll(db: Database): Promise<void> {
  const result = await db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  const tables = result.rows.map((row) => `"public"."${row.table_name}"`);
  if (tables.length > 0) {
    await db.execute(sql.raw(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`));
  }
}

export async function countRows(db: Database, table: string): Promise<number> {
  const result = await db.execute<{ count: string }>(
    sql.raw(`select count(*)::text as count from "public"."${table}"`),
  );
  return Number(result.rows[0]?.count);
}

let ipCounter = 0;
/** Una IP distinta por llamada, para que los tests no compartan límites. */
export function uniqueIp(): string {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

const internalKey = (): string => process.env.INTERNAL_API_KEY ?? '';

/** Cliente con la clave interna y una IP propia. */
export function api(app: NestExpressApplication, ip = uniqueIp()) {
  const agent = request(app.getHttpServer());
  const prepare = (test: request.Test) =>
    test.set('X-Internal-Api-Key', internalKey()).set('X-Client-Ip', ip);
  return {
    get: (path: string) => prepare(agent.get(path)),
    post: (path: string) => prepare(agent.post(path)),
  };
}

type RegisterOverrides = Partial<Record<keyof RegisterRequest, unknown>>;

/** Cuerpo de registro válido; `overrides` permite valores inválidos para probar errores. */
export function registerBody(overrides: RegisterOverrides = {}) {
  const defaults = {
    email: `persona+${randomUUID()}@example.com`,
    password: 'contraseña-segura-1',
    birthDate: '1990-05-05',
    acceptTerms: true,
    termsVersion: SERVICE_TERMS_VERSION,
  };
  return { ...defaults, ...overrides } as typeof defaults;
}

/** Registra un usuario y devuelve su token, su id y los datos usados. */
export async function registerUser(app: NestExpressApplication, overrides: RegisterOverrides = {}) {
  const body = registerBody(overrides);
  const response = await api(app).post('/auth/register').send(body);
  if (response.status !== 201) {
    throw new Error(
      `Registro de prueba fallido: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
  const auth = response.body as { user: { id: string; email: string }; session: { token: string } };
  return { ...body, userId: auth.user.id, token: auth.session.token, email: auth.user.email };
}
