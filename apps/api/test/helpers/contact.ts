import { PRIVACY_POLICY_VERSION } from '@cupidilla/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../../src/database/database.types.js';

/** Datos comunes de las pruebas de contacto (técnico de contacto §12). */
export const CONTACT_NOW = '2026-11-22T10:00:00.000Z';
export const CONTACT_INBOX = 'contacto@example.com';
export const LUCIA = 'lucia@example.com';
export const LUCIA_IP = '203.0.113.7';

/** El formulario válido de Lucía; `overrides` permite valores inválidos para probar errores. */
export function contactBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Lucía Pérez',
    email: 'Lucia@Example.com',
    subject: 'Duda sobre mi cuenta',
    message: 'Hola,\r\nno me llega el correo.',
    acceptPrivacy: true,
    privacyPolicyVersion: PRIVACY_POLICY_VERSION,
    ...overrides,
  };
}

export type ContactRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string;
  message: string;
  privacy_policy_version: string;
  created_at: Date;
  notified_at: Date | null;
  ack_requested: boolean;
  length: number;
};

/** Filas de `contact_messages`, por fecha, con `char_length(message)`. */
export async function contactRows(db: Database): Promise<ContactRow[]> {
  const result = await db.execute<ContactRow>(
    sql`select *, char_length(message) as length from contact_messages order by created_at, id`,
  );
  return result.rows;
}
