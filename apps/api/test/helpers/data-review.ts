import { sql } from 'drizzle-orm';
import { expect } from 'vitest';
import { BETO, deliverMail, linkTo, registerBeto } from './mail.js';
import { api, type TestApp } from './test-app.js';

/** Contraseña que fija el restablecimiento en las pruebas de la fase C. */
export const NEW_PASSWORD = 'otra frase larga nueva';

/** Tablas con FK hacia `users`, consultadas en el catálogo. */
export async function rowsReferencingUser(t: TestApp, userId: string): Promise<number> {
  const fks = await t.db.execute<{ table_name: string; column_name: string }>(sql`
    select kcu.table_name, kcu.column_name
    from information_schema.referential_constraints rc
    join information_schema.key_column_usage kcu on kcu.constraint_name = rc.constraint_name
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = rc.unique_constraint_name
    where ccu.table_name = 'users' and kcu.table_schema = 'public'`);
  expect(fks.rows.length).toBeGreaterThan(0);
  let total = 0;
  for (const { table_name, column_name } of fks.rows) {
    const result = await t.db.execute<{ count: string }>(
      sql.raw(
        `select count(*)::text as count from "public"."${table_name}" where "${column_name}" = '${userId}'`,
      ),
    );
    total += Number(result.rows[0]?.count);
  }
  return total;
}

/**
 * Beto se registra (sin verificar) y el dueño del buzón restablece la contraseña: queda pendiente
 * de revisión. Devuelve su id y la sesión que abre el restablecimiento.
 */
export async function pendingBeto(t: TestApp): Promise<{ userId: string; token: string }> {
  const { userId } = await registerBeto(t.app, t.db);
  await api(t.app).post('/auth/password-reset/request').send({ email: BETO });
  await deliverMail(t.app);
  const link = linkTo(t.app, BETO, '/reset-password');
  const response = await api(t.app)
    .post('/auth/password-reset')
    .send({ token: link, password: NEW_PASSWORD });
  if (response.status !== 200) throw new Error(`Restablecimiento fallido: ${response.status}`);
  return { userId, token: response.body.session.token as string };
}
