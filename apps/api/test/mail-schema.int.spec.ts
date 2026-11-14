import { eq, sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { emailOutbox, emailTokens } from '../src/database/schema/index.js';
import { Transactions } from '../src/database/transactions.js';
import { EmailTokensService } from '../src/mail/email-tokens.service.js';
import { OutboxService } from '../src/mail/outbox.service.js';
import { BETO, seedBeto } from './helpers/mail.js';
import { runFlow, signupBody } from './helpers/oauth.js';
import {
  api,
  countRows,
  createTestApp,
  registerUser,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

/** Esquema del correo (correo §3, tarea A.3). */
describe('A.3: esquema de users, email_tokens y email_outbox (§3)', () => {
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

  /** La sentencia falla por esa restricción (`code` de PostgreSQL y nombre). */
  async function expectViolation(query: SQL, code: string, constraint: string): Promise<void> {
    await expect(t.db.execute(query)).rejects.toMatchObject({ cause: { code, constraint } });
  }

  it('A3-2: una cuenta sin contraseña tiene que nacer verificada', async () => {
    await expectViolation(
      sql`insert into users (email, password_hash, birth_date, email_verified_at)
          values ('sin@example.com', null, '1990-05-05', null)`,
      '23514',
      'users_unverified_has_password',
    );
  });

  it('A3-3: la marca de revisión exige el correo verificado', async () => {
    await expectViolation(
      sql`insert into users (email, password_hash, birth_date, email_verified_at, data_review_required_at)
          values ('rev@example.com', 'hash', '1990-05-05', null, ${TEST_NOW})`,
      '23514',
      'users_review_requires_verified',
    );
  });

  it('A3-4: un solo email_tokens por usuario y propósito', async () => {
    const betoId = await seedBeto(t.db);
    const insert = (hash: string) => sql`
      insert into email_tokens (token_hash, user_id, purpose, email, created_at, expires_at)
      values (${hash}, ${betoId}, 'verify_email', ${BETO}, ${TEST_NOW}, ${TEST_NOW})`;
    await t.db.execute(insert('a'.repeat(64)));
    await expectViolation(insert('b'.repeat(64)), '23505', 'email_tokens_user_purpose_unique');
  });

  it('A3-5: como mucho una fila pendiente por tipo y dirección; una fallida no cuenta', async () => {
    const outbox = t.app.get(OutboxService);
    await outbox.enqueue(t.db, 'verify_email', BETO);
    await outbox.enqueue(t.db, 'verify_email', BETO);
    expect(await countRows(t.db, 'email_outbox')).toBe(1);

    await t.db.update(emailOutbox).set({ failedAt: t.clock.now() });
    await outbox.enqueue(t.db, 'verify_email', BETO);
    expect(await countRows(t.db, 'email_outbox')).toBe(2);
  });

  it('A3-6: al borrar la cuenta desaparecen sus email_tokens', async () => {
    const user = await registerUser(t.app);
    await t.app.get(Transactions).run((tx) =>
      t.app.get(EmailTokensService).issue(tx, {
        userId: user.userId,
        purpose: 'verify_email',
        email: user.email,
        ttlMs: 60_000,
      }),
    );
    expect(await countRows(t.db, 'email_tokens')).toBe(1);

    const deleted = await api(t.app)
      .post('/users/me/deletion')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ password: user.password });
    expect(deleted.status).toBe(204);
    expect(
      await t.db.select().from(emailTokens).where(eq(emailTokens.userId, user.userId)),
    ).toEqual([]);
  });

  it('las cuentas del registro nacen sin verificar y las de proveedor, verificadas', async () => {
    const user = await registerUser(t.app, {}, { verified: false });
    const flow = await runFlow(t.app);
    const created = await api(t.app)
      .post('/auth/oauth/signup')
      .send(signupBody(flow.response.body.pending.token as string));
    expect(created.status).toBe(201);

    const result = await t.db.execute<{ id: string; email_verified_at: string | null }>(
      sql`select id, email_verified_at::text from users`,
    );
    const verifiedAt = new Map(result.rows.map((row) => [row.id, row.email_verified_at]));
    expect(verifiedAt.get(user.userId)).toBeNull();
    expect(verifiedAt.get(created.body.user.id as string)).toBe('2026-11-11 10:00:00+00');
  });
});
