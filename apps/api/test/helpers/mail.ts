import type { NestExpressApplication } from '@nestjs/platform-express';
import { identities, users } from '../../src/database/schema/index.js';
import type { Database } from '../../src/database/database.types.js';
import { Mailer } from '../../src/mail/mailer.js';
import { MemoryMailer } from '../../src/mail/memory.mailer.js';
import { OutboxWorker, type DrainResult } from '../../src/mail/outbox.worker.js';
import { TEST_NOW } from './test-app.js';

/**
 * Correo en la integración (correo §11.1): `MemoryMailer` y `drain()` a mano, porque con
 * `NODE_ENV=test` y sin `SMTP_URL` el *worker* no arranca su temporizador.
 */

/** La bandeja en memoria de la app. */
export function inbox(app: NestExpressApplication): MemoryMailer {
  const mailer = app.get(Mailer);
  if (!(mailer instanceof MemoryMailer)) throw new Error('La app de pruebas no usa MemoryMailer');
  return mailer;
}

/** Envía lo pendiente del *outbox* (`OutboxWorker.drain()`). */
export function deliverMail(app: NestExpressApplication): Promise<DrainResult> {
  return app.get(OutboxWorker).drain();
}

/** Token del último correo a `email` con un enlace a `path` (p. ej. `/verify-email`). */
export function linkTo(app: NestExpressApplication, email: string, path: string): string {
  const mailer = inbox(app);
  const messages = mailer.messagesTo(email);
  for (const message of messages.reverse()) {
    const token = mailer.linkIn(message, path);
    if (token) return token;
  }
  throw new Error(`No hay ningún correo a ${email} con un enlace a ${path}`);
}

/** Datos comunes de las pruebas de correo (correo §11.3). */
export const ANA = 'ana@example.com';
export const BETO = 'beto@example.com';
export const CARLA = 'carla@gmail.com';
export const CARLA_FB = 'carla.fb@example.com';
export const NADIE = 'nadie@example.com';
/** Un hash argon2id cualquiera: estas pruebas no entran con contraseña. */
const SOME_HASH = '$argon2id$v=19$m=65536,t=3,p=4$prueba';

async function insertUser(
  db: Database,
  values: { email: string; passwordHash: string | null; verifiedAt: Date | null; createdAt: Date },
): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      email: values.email,
      passwordHash: values.passwordHash,
      birthDate: '1990-05-05',
      emailVerifiedAt: values.verifiedAt,
      createdAt: values.createdAt,
      updatedAt: values.createdAt,
    })
    .returning({ id: users.id });
  if (!row) throw new Error('INSERT de users sin fila');
  return row.id;
}

/** Ana: con contraseña y correo verificado, creada el 2026-10-01. */
export function seedAna(db: Database): Promise<string> {
  const createdAt = new Date('2026-10-01T10:00:00.000Z');
  return insertUser(db, {
    email: ANA,
    passwordHash: SOME_HASH,
    verifiedAt: createdAt,
    createdAt,
  });
}

/** Beto: registrado con contraseña el 2026-11-11T10:00:00Z, sin verificar. */
export function seedBeto(db: Database): Promise<string> {
  return insertUser(db, {
    email: BETO,
    passwordHash: SOME_HASH,
    verifiedAt: null,
    createdAt: new Date(TEST_NOW),
  });
}

/**
 * Carla: cuenta creada con Google (`carla@gmail.com`, sin contraseña) con Facebook unido
 * (`provider_email` `carla.fb@example.com`, verificado).
 */
export async function seedCarla(db: Database): Promise<string> {
  const createdAt = new Date('2026-10-15T10:00:00.000Z');
  const userId = await insertUser(db, {
    email: CARLA,
    passwordHash: null,
    verifiedAt: createdAt,
    createdAt,
  });
  await db.insert(identities).values([
    {
      userId,
      provider: 'facebook',
      subject: 'carla-fb',
      providerEmail: CARLA_FB,
      emailVerified: true,
      createdAt,
      lastUsedAt: createdAt,
    },
    {
      userId,
      provider: 'google',
      subject: 'carla-google',
      providerEmail: CARLA,
      emailVerified: true,
      createdAt,
      lastUsedAt: createdAt,
    },
  ]);
  return userId;
}
