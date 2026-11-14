import { ConfigService } from '@nestjs/config';
import { eq, sql } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/config/env.schema.js';
import { hashOpaqueToken } from '../src/common/crypto/opaque-token.js';
import { emailOutbox, emailTokens } from '../src/database/schema/index.js';
import { Transactions } from '../src/database/transactions.js';
import { OutboxService, type MailKind } from '../src/mail/outbox.service.js';
import { OUTBOX_RETRY_DELAYS_MS } from '../src/mail/outbox.worker.js';
import { mailOptions } from '../src/mail/smtp.mailer.js';
import {
  ANA,
  BETO,
  CARLA_FB,
  deliverMail,
  inbox,
  NADIE,
  seedAna,
  seedBeto,
  seedCarla,
} from './helpers/mail.js';
import {
  countRows,
  createTestApp,
  TEST_NOW,
  truncateAll,
  type TestApp,
} from './helpers/test-app.js';

/** `MailModule`: *outbox*, *worker*, resolución del destinatario y tokens (correo §4, tarea A.4). */
describe('A.4: outbox y worker de correo (§4)', () => {
  let t: TestApp;
  let outbox: OutboxService;

  beforeAll(async () => {
    t = await createTestApp();
    outbox = t.app.get(OutboxService);
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await truncateAll(t.db);
    inbox(t.app).clear();
    t.clock.set(TEST_NOW);
  });

  const enqueue = (kind: MailKind, email: string) => outbox.enqueue(t.db, kind, email);
  const outboxRows = () => t.db.select().from(emailOutbox);
  const tokensOf = (userId: string) =>
    t.db.select().from(emailTokens).where(eq(emailTokens.userId, userId));
  const at = (iso: string) => new Date(iso);

  it('A4-1: una transacción que encola y después falla no deja fila ni correo', async () => {
    await seedBeto(t.db);
    await expect(
      t.app.get(Transactions).run(async (tx) => {
        await outbox.enqueue(tx, 'verify_email', BETO);
        throw new Error('fallo después de encolar');
      }),
    ).rejects.toThrow('fallo después de encolar');

    await deliverMail(t.app);
    expect(await countRows(t.db, 'email_outbox')).toBe(0);
    expect(inbox(t.app).messages).toEqual([]);
  });

  it('A4-2: «Confirma tu correo» a Beto: enlace con token de 43, pie, texto y HTML; solo el hash en la base', async () => {
    const betoId = await seedBeto(t.db);
    await enqueue('verify_email', BETO);

    expect(await deliverMail(t.app)).toEqual({ sent: 1, skipped: 0, retried: 0, failed: 0 });

    const messages = inbox(t.app).messages;
    expect(messages).toHaveLength(1);
    const [message] = messages;
    expect(message?.to).toBe(BETO);
    // From = MAIL_FROM de la configuración, tal como lo compone SmtpMailer (mailOptions).
    const mailFrom = t.app.get(ConfigService<Env, true>).get('MAIL_FROM', { infer: true });
    expect(mailFrom).toBe('Cupidilla <no-reply@example.com>');
    const raw = await nodemailer
      .createTransport({ streamTransport: true, buffer: true })
      .sendMail(mailOptions(mailFrom, message!));
    expect(raw.message.toString()).toContain(`From: ${mailFrom}`);
    expect(message?.text).toContain('Si necesitas ayuda, escribe a soporte@example.com.');
    expect(message?.html).toContain('Si necesitas ayuda, escribe a soporte@example.com.');
    expect(message?.text.length).toBeGreaterThan(0);
    expect(message?.html).toMatch(/^<!doctype html>/);
    expect(message?.html).not.toContain('<img');
    const link =
      /http:\/\/localhost:5173\/verify-email\?token=([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(
        message!.text,
      );
    expect(link).not.toBeNull();
    const token = link![1]!;
    expect(inbox(t.app).linkIn(message!, '/verify-email')).toBe(token);

    const tokens = await tokensOf(betoId);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      tokenHash: hashOpaqueToken(token),
      purpose: 'verify_email',
      email: BETO,
      expiresAt: at('2026-11-12T10:00:00.000Z'),
    });
    expect(await countRows(t.db, 'email_outbox')).toBe(0);
  });

  it('A4-3: un segundo envío sustituye al token del primero', async () => {
    const betoId = await seedBeto(t.db);
    await enqueue('verify_email', BETO);
    await deliverMail(t.app);
    const [first] = await tokensOf(betoId);

    await enqueue('verify_email', BETO);
    await deliverMail(t.app);
    const tokens = await tokensOf(betoId);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.tokenHash).not.toBe(first?.tokenHash);
    expect(inbox(t.app).messagesTo(BETO)).toHaveLength(2);
  });

  it('A4-4: un fallo transitorio se reintenta a los 30 s y luego sale', async () => {
    await seedBeto(t.db);
    await enqueue('verify_email', BETO);
    inbox(t.app).failNext(1, { permanent: false });

    expect(await deliverMail(t.app)).toMatchObject({ sent: 0, retried: 1 });
    const [row] = await outboxRows();
    expect(row).toMatchObject({
      attempts: 1,
      nextAttemptAt: at('2026-11-11T10:00:30.000Z'),
      lockedUntil: null,
      failedAt: null,
    });
    expect(row?.lastError).toMatch(/^[a-z0-9_]+$/i);

    t.clock.set('2026-11-11T10:00:31.000Z');
    expect(await deliverMail(t.app)).toMatchObject({ sent: 1 });
    expect(inbox(t.app).messagesTo(BETO)).toHaveLength(1);
    expect(await countRows(t.db, 'email_outbox')).toBe(0);
  });

  it('A4-5: un fallo permanente marca failed_at y no se vuelve a intentar', async () => {
    await seedBeto(t.db);
    await enqueue('verify_email', BETO);
    inbox(t.app).failNext(1, { permanent: true });

    expect(await deliverMail(t.app)).toMatchObject({ failed: 1 });
    const [row] = await outboxRows();
    expect(row?.failedAt).toEqual(at(TEST_NOW));
    expect(row?.lastError).toBe('smtp_550');

    t.clock.advanceDays(1);
    expect(await deliverMail(t.app)).toEqual({ sent: 0, skipped: 0, retried: 0, failed: 0 });
    expect(inbox(t.app).messages).toEqual([]);
  });

  it('A4-6: el 8.º fallo transitorio marca failed_at; la fila fallida se borra a los 7 días', async () => {
    await seedBeto(t.db);
    await enqueue('verify_email', BETO);
    inbox(t.app).failNext(8, { permanent: false });

    for (const delay of OUTBOX_RETRY_DELAYS_MS) {
      expect(await deliverMail(t.app)).toMatchObject({ retried: 1 });
      t.clock.set(new Date(t.clock.now().getTime() + delay));
    }
    expect(await deliverMail(t.app)).toMatchObject({ failed: 1 });
    const [row] = await outboxRows();
    expect(row?.attempts).toBe(8);
    expect(row?.failedAt).toEqual(t.clock.now());

    t.clock.advanceDays(8);
    await deliverMail(t.app);
    expect(await countRows(t.db, 'email_outbox')).toBe(0);
    expect(inbox(t.app).messages).toEqual([]);
  });

  it('A4-7: una fila con la concesión vigente no se envía; vencida, sí', async () => {
    await seedBeto(t.db);
    await enqueue('verify_email', BETO);
    await t.db
      .update(emailOutbox)
      .set({ lockedUntil: at('2026-11-11T10:01:00.000Z') })
      .where(eq(emailOutbox.toEmail, BETO));

    expect(await deliverMail(t.app)).toMatchObject({ sent: 0 });
    expect(inbox(t.app).messages).toEqual([]);

    t.clock.set('2026-11-11T10:02:01.000Z');
    expect(await deliverMail(t.app)).toMatchObject({ sent: 1 });
    expect(inbox(t.app).messagesTo(BETO)).toHaveLength(1);
  });

  it('A4-8: dos drain() a la vez envían cada fila una sola vez', async () => {
    await seedAna(t.db);
    await seedBeto(t.db);
    await seedCarla(t.db);
    for (const email of [ANA, BETO, 'carla@gmail.com']) await enqueue('password_changed', email);

    const results = await Promise.all([deliverMail(t.app), deliverMail(t.app)]);
    expect(results.reduce((sum, result) => sum + result.sent, 0)).toBe(3);
    expect(inbox(t.app).messages).toHaveLength(3);
    expect(new Set(inbox(t.app).messages.map((message) => message.to)).size).toBe(3);
  });

  it('A4-9: sin a quién enviar, las filas se descartan sin correo', async () => {
    await seedAna(t.db);
    await enqueue('reset_password', NADIE);
    await enqueue('verify_email', ANA);
    await enqueue('signup_notice', NADIE);

    expect(await deliverMail(t.app)).toEqual({ sent: 0, skipped: 3, retried: 0, failed: 0 });
    expect(inbox(t.app).messages).toEqual([]);
    expect(await countRows(t.db, 'email_outbox')).toBe(0);
    expect(await countRows(t.db, 'email_tokens')).toBe(0);
  });

  it('A4-10: el aviso de registro elige su variante al enviar y no lleva token', async () => {
    await seedAna(t.db);
    await seedBeto(t.db);
    await seedCarla(t.db);
    for (const email of [ANA, BETO, CARLA_FB]) await enqueue('signup_notice', email);

    expect(await deliverMail(t.app)).toMatchObject({ sent: 3 });
    const [ana] = inbox(t.app).messagesTo(ANA);
    const [beto] = inbox(t.app).messagesTo(BETO);
    const [carla] = inbox(t.app).messagesTo(CARLA_FB);
    for (const message of [ana, beto, carla]) {
      expect(message?.subject).toBe('Alguien ha intentado registrarse con tu correo');
      expect(message?.text).not.toContain('token=');
      expect(message?.html).not.toContain('token=');
    }
    // (a) cuenta verificada.
    expect(ana?.text).toMatch(/^Ya tienes una cuenta en Cupidilla\n/);
    // (b) sin verificar, con su fecha de borrado (created_at + 7 días en Europe/Madrid).
    expect(beto?.text).toMatch(/^Hay una cuenta sin confirmar con tu correo\n/);
    expect(beto?.text).toContain('se borrará el 18 de noviembre de 2026');
    // (c) correo de un proveedor unido a una cuenta con otro correo: nombra sus proveedores.
    expect(carla?.text).toMatch(/^Tu correo ya está unido a una cuenta\n/);
    expect(carla?.text).toContain('a través de Google y Facebook');
    expect(carla?.text).not.toContain('carla@gmail.com');
    expect(carla?.text).not.toContain('/forgot-password');
    expect(await countRows(t.db, 'email_tokens')).toBe(0);
  });

  it('A4-11: drain() borra los email_tokens caducados', async () => {
    // Un instante que ningún otro drain() de este archivo usa: la limpieza va como mucho una vez
    // por minuto.
    t.clock.set('2026-12-01T08:00:00.000Z');
    const betoId = await seedBeto(t.db);
    await t.db.insert(emailTokens).values({
      tokenHash: 'c'.repeat(64),
      userId: betoId,
      purpose: 'verify_email',
      email: BETO,
      createdAt: at('2026-11-30T08:00:00.000Z'),
      expiresAt: at('2026-12-01T07:59:00.000Z'),
    });

    await deliverMail(t.app);
    expect(await countRows(t.db, 'email_tokens')).toBe(0);
  });

  it('ninguna fila del outbox guarda un token ni un enlace', async () => {
    await seedBeto(t.db);
    await enqueue('verify_email', BETO);
    inbox(t.app).failNext(1, { permanent: false });
    await deliverMail(t.app);
    const rows = await t.db.execute<{ row: string }>(
      sql`select row_to_json(o)::text as row from email_outbox o`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.row).not.toMatch(/token|http/);
  });
});
