import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { ThrottlerStorage, type ThrottlerStorageService } from '@nestjs/throttler';
import { SERVICE_TERMS_VERSION, type RegisterRequest } from '@cupidilla/contracts';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { Clock } from '../../src/common/clock.js';
import { configureApp } from '../../src/configure-app.js';
import { DB, type Database } from '../../src/database/database.types.js';
import { FakeClock } from './fake-clock.js';
import { deliverMail, linkTo } from './mail.js';

export const TEST_NOW = '2026-11-11T10:00:00.000Z';

export interface TestApp {
  app: NestExpressApplication;
  clock: FakeClock;
  db: Database;
}

/** App completa con `configureApp`, base de datos real y `Clock` falso. */
export async function createTestApp(
  options: {
    now?: string;
    /** Para sustituir más proveedores de Nest (p. ej. los clientes OAuth). */
    override?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
  } = {},
): Promise<TestApp> {
  const clock = new FakeClock(options.now ?? TEST_NOW);
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(clock);
  const moduleRef = await (options.override ? options.override(builder) : builder).compile();
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

/**
 * Vacía los contadores del límite de intentos (en memoria). Para los archivos que registran el
 * mismo correo en varias pruebas: el límite por correo (3 registros cada 24 h) no depende del
 * reloj falso ni de `truncateAll`.
 */
export function resetRateLimits(app: NestExpressApplication): void {
  const storage = app.get<ThrottlerStorageService>(ThrottlerStorage);
  storage.storage.clear();
  // Los aciertos vivos de cada cubo van aparte (detalle interno de @nestjs/throttler 6.7).
  (storage as unknown as { hitExpirations: Map<string, unknown> }).hitExpirations.clear();
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

/**
 * Registra un usuario (202), entrega el correo y devuelve su token de sesión, su id y los datos
 * usados (correo §11.1). Con `verified` (por defecto), confirma el correo con la contraseña y usa
 * la sesión que abre; si no, entra con `POST /auth/login` y la cuenta queda sin verificar.
 */
export async function registerUser(
  app: NestExpressApplication,
  overrides: RegisterOverrides = {},
  { verified = true }: { verified?: boolean } = {},
) {
  const body = registerBody(overrides);
  const email = body.email.trim().toLowerCase();
  const response = await api(app).post('/auth/register').send(body);
  if (response.status !== 202) {
    throw new Error(
      `Registro de prueba fallido: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
  await deliverMail(app);
  const auth = verified
    ? await confirmWithPassword(app, linkTo(app, email, '/verify-email'), body.password)
    : await loginAs(app, email, body.password);
  return { ...body, userId: auth.user.id, token: auth.session.token, email: auth.user.email };
}

type AuthBody = { user: { id: string; email: string }; session: { token: string } };

async function confirmWithPassword(
  app: NestExpressApplication,
  token: string,
  password: string,
): Promise<AuthBody> {
  const response = await api(app).post('/auth/email-verification').send({ token, password });
  if (response.status !== 200 || response.body.session !== 'opened') {
    throw new Error(`Verificación de prueba fallida: ${response.status}`);
  }
  return response.body.auth as AuthBody;
}

async function loginAs(
  app: NestExpressApplication,
  email: string,
  password: string,
): Promise<AuthBody> {
  const response = await api(app).post('/auth/login').send({ email, password });
  if (response.status !== 200) throw new Error(`Login de prueba fallido: ${response.status}`);
  return response.body as AuthBody;
}
