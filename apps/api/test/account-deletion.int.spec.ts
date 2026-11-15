import { eq, sql } from 'drizzle-orm';
import { emailOutbox, sessions } from '../src/database/schema/index.js';
import { PasswordService } from '../src/users/password.service.js';
import { UsersService } from '../src/users/users.service.js';
import { OutboxService } from '../src/mail/outbox.service.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deliverMail, linkTo } from './helpers/mail.js';
import {
  api,
  countRows,
  createTestApp,
  registerBody,
  registerUser,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

describe('Eliminación de la cuenta', () => {
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
    vi.restoreAllMocks();
  });

  const deleteAccount = (token: string, password: string) =>
    api(t.app)
      .post('/users/me/deletion')
      .set('Authorization', `Bearer ${token}`)
      .send({ password });

  const login = (email: string, password: string) =>
    api(t.app).post('/auth/login').send({ email, password });

  /** Filas con ese user_id en todas las tablas que tienen una FK hacia users. */
  async function rowsReferencingUser(userId: string): Promise<Record<string, number>> {
    const references = await t.db.execute<{ table_name: string; column_name: string }>(sql`
      select kcu.table_name, kcu.column_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
      where tc.constraint_type = 'FOREIGN KEY'
        and tc.table_schema = 'public'
        and ccu.table_name = 'users'
    `);
    const counts: Record<string, number> = {};
    for (const { table_name, column_name } of references.rows) {
      const result = await t.db.execute<{ count: string }>(
        sql`select count(*)::text as count from ${sql.identifier(table_name)} where ${sql.identifier(column_name)} = ${userId}`,
      );
      counts[table_name] = Number(result.rows[0]?.count);
    }
    const users = await t.db.execute<{ count: string }>(
      sql`select count(*)::text as count from users where id = ${userId}`,
    );
    counts.users = Number(users.rows[0]?.count);
    return counts;
  }

  it('I-15: con una contraseña errónea → 403 PASSWORD_INCORRECT y no se borra nada', async () => {
    const user = await registerUser(t.app);
    const response = await deleteAccount(user.token, 'contraseña-errónea');
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('PASSWORD_INCORRECT');
    expect(await rowsReferencingUser(user.userId)).toEqual({
      users: 1,
      sessions: 1,
      consents: 1,
      email_tokens: 0,
      identities: 0,
      pending_identities: 0,
    });
    expect(
      (await api(t.app).get('/auth/session').set('Authorization', `Bearer ${user.token}`)).status,
    ).toBe(200);
  });

  it('I-16: el borrado no deja nada y libera el correo', async () => {
    const user = await registerUser(t.app);
    const otherDevice = await login(user.email, user.password);
    expect(otherDevice.status).toBe(200);

    const response = await deleteAccount(user.token, user.password);
    expect(response.status).toBe(204);

    const remaining = await rowsReferencingUser(user.userId);
    // Toda tabla con FK a users entra aquí (oauth_states cuelga de sessions, no de users).
    expect(Object.keys(remaining).sort()).toEqual([
      'consents',
      'email_tokens',
      'identities',
      'pending_identities',
      'sessions',
      'users',
    ]);
    expect(Object.values(remaining).every((count) => count === 0)).toBe(true);
    const emailRows = await t.db.execute<{ count: string }>(
      sql`select count(*)::text as count from users where email = ${user.email}`,
    );
    expect(Number(emailRows.rows[0]?.count)).toBe(0);

    for (const token of [user.token, otherDevice.body.session.token as string]) {
      const session = await api(t.app).get('/auth/session').set('Authorization', `Bearer ${token}`);
      expect(session.status).toBe(401);
    }
    expect((await login(user.email, user.password)).status).toBe(401);

    const again = await api(t.app)
      .post('/auth/register')
      .send(registerBody({ email: user.email }));
    expect(again.status).toBe(202);
    expect(await countRows(t.db, 'users')).toBe(1);
  });

  it('I-17: borrar al usuario A no toca las filas del usuario B', async () => {
    const a = await registerUser(t.app);
    const b = await registerUser(t.app);
    expect((await deleteAccount(a.token, a.password)).status).toBe(204);
    expect(await rowsReferencingUser(b.userId)).toEqual({
      users: 1,
      sessions: 1,
      consents: 1,
      email_tokens: 0,
      identities: 0,
      pending_identities: 0,
    });
    expect(await countRows(t.db, 'users')).toBe(1);
  });

  /** Correo 3.5: filas del outbox (pendiente y fallida) de la cuenta y una de otra persona. */
  async function seedOutbox(email: string): Promise<void> {
    const outbox = t.app.get(OutboxService);
    await outbox.enqueue(t.db, 'password_changed', email);
    await t.db.update(emailOutbox).set({ failedAt: t.clock.now() });
    await outbox.enqueue(t.db, 'password_changed', email);
    await outbox.enqueue(t.db, 'signup_notice', email);
    await outbox.enqueue(t.db, 'signup_notice', 'otra@example.com');
  }
  const outboxTo = async (email: string) =>
    (await t.db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, email))).length;

  it('§3.5: borrar la cuenta borra sus filas del outbox (pendientes y fallidas), no las de otros', async () => {
    const user = await registerUser(t.app);
    await seedOutbox(user.email);
    expect(await outboxTo(user.email)).toBe(3);

    expect((await deleteAccount(user.token, user.password)).status).toBe(204);
    expect(await outboxTo(user.email)).toBe(0);
    expect(await outboxTo('otra@example.com')).toBe(1);
  });

  type Deleter = {
    deleteUserAndMail(
      session: { userId: string; tokenHash: string },
      verifiedHash: string | null,
    ): Promise<void>;
  };
  const sessionOf = async (userId: string) => {
    const [row] = await t.db.select().from(sessions).where(eq(sessions.userId, userId));
    return { userId, tokenHash: row!.tokenHash };
  };

  it('§3.5: si la fila del usuario ya no existe (carrera), el borrado no toca el outbox de ese correo', async () => {
    const user = await registerUser(t.app);
    await seedOutbox(user.email);
    const service = t.app.get(UsersService) as unknown as Deleter;
    // Un id que no existe: el DELETE del usuario no devuelve nada y los correos se quedan.
    await expect(
      service.deleteUserAndMail(
        { userId: '00000000-0000-4000-8000-000000000000', tokenHash: 'x' },
        null,
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(await outboxTo(user.email)).toBe(3);
    expect(await countRows(t.db, 'users')).toBe(1);
  });

  it('un restablecimiento que hace COMMIT mientras el borrado verifica la contraseña: no se borra la cuenta recuperada', async () => {
    const user = await registerUser(t.app);
    await seedOutbox(user.email);
    expect(
      (await api(t.app).post('/auth/password-reset/request').send({ email: user.email })).status,
    ).toBe(202);
    await deliverMail(t.app);
    const link = linkTo(t.app, user.email, '/reset-password');
    const newPassword = 'otra frase larga nueva';

    // El borrado se para dentro de la verificación (el argon2 de la contraseña vieja).
    const passwords = t.app.get(PasswordService);
    const verify = passwords.verify.bind(passwords);
    let reached!: () => void;
    const inVerify = new Promise<void>((resolve) => (reached = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(passwords, 'verify').mockImplementation(async (hash, password) => {
      reached();
      await gate;
      return verify(hash, password);
    });
    const deleting = deleteAccount(user.token, user.password).then((response) => response);
    let resetStatus: number | undefined;
    try {
      await inVerify;
      vi.restoreAllMocks();
      resetStatus = (
        await api(t.app).post('/auth/password-reset').send({ token: link, password: newPassword })
      ).status;
    } finally {
      release();
    }
    const response = await deleting;
    expect(resetStatus).toBe(200);
    expect(response.status).not.toBe(204);
    expect(response.status).toBe(401); // el restablecimiento revocó la sesión de la petición
    expect(await countRows(t.db, 'users')).toBe(1);
    expect(await outboxTo(user.email)).toBeGreaterThan(0);
    expect((await login(user.email, newPassword)).status).toBe(200);
  });

  it('con la sesión viva pero la contraseña cambiada desde la lectura: 403 PASSWORD_INCORRECT y la cuenta sigue', async () => {
    const user = await registerUser(t.app);
    const service = t.app.get(UsersService) as unknown as Deleter;
    const session = await sessionOf(user.userId);
    // Se «leyó» un hash que ya no es el vigente (o `null`, si la cuenta no tenía contraseña).
    for (const stale of [null, '$argon2id$v=19$m=65536,t=3,p=4$otro']) {
      await expect(service.deleteUserAndMail(session, stale)).rejects.toMatchObject({
        code: 'PASSWORD_INCORRECT',
        status: 403,
      });
    }
    expect(await countRows(t.db, 'users')).toBe(1);
  });

  it('valida el cuerpo y exige sesión', async () => {
    const user = await registerUser(t.app);
    const empty = await api(t.app)
      .post('/users/me/deletion')
      .set('Authorization', `Bearer ${user.token}`)
      .send({});
    expect(empty.status).toBe(400);
    expect(empty.body.error.fields).toEqual([{ path: 'password', issue: 'required' }]);
    const anonymous = await api(t.app).post('/users/me/deletion').send({ password: 'x' });
    expect(anonymous.status).toBe(401);
  });
});
