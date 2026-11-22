import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { emailOutbox } from '../src/database/schema/index.js';
import { MailResolver } from '../src/mail/mail-resolver.js';
import { OutboxService } from '../src/mail/outbox.service.js';
import { UnverifiedAccountsSweeper } from '../src/users/unverified-accounts.sweeper.js';
import {
  CONTACT_INBOX,
  CONTACT_NOW,
  contactBody,
  contactRows,
  LUCIA,
  LUCIA_IP,
} from './helpers/contact.js';
import { deliverMail, inbox } from './helpers/mail.js';
import {
  api,
  countRows,
  createTestApp,
  registerUser,
  resetRateLimits,
  truncateAll,
  uniqueIp,
  type TestApp,
} from './helpers/test-app.js';

/** POST /contact y sus correos (técnico de contacto §5, §4, §12), con CONTACT_ACK_EMAIL=false. */
describe('T7: formulario de contacto', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ now: CONTACT_NOW });
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await truncateAll(t.db);
    resetRateLimits(t.app);
    inbox(t.app).clear();
    t.clock.set(CONTACT_NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const send = (body: Record<string, unknown>, ip = uniqueIp()) =>
    api(t.app, ip).post('/contact').send(body);

  /** Ninguna fila ni correo: lo que se comprueba tras cada rechazo. */
  async function expectNothingSaved(): Promise<void> {
    expect(await countRows(t.db, 'contact_messages')).toBe(0);
    expect(await countRows(t.db, 'email_outbox')).toBe(0);
    await deliverMail(t.app);
    expect(inbox(t.app).messages).toEqual([]);
  }

  it('C1: guarda el mensaje normalizado y envía un correo al buzón con Reply-To', async () => {
    const response = await send(contactBody(), LUCIA_IP);
    expect(response.status).toBe(202);
    expect(response.text).toBe('');

    const [row, ...others] = await contactRows(t.db);
    expect(others).toEqual([]);
    expect(row).toMatchObject({
      name: 'Lucía Pérez',
      email: LUCIA,
      phone: null,
      subject: 'Duda sobre mi cuenta',
      message: 'Hola,\nno me llega el correo.',
      privacy_policy_version: '2026-11-borrador',
      notified_at: null,
    });
    expect(new Date(row?.created_at ?? 0).toISOString()).toBe(CONTACT_NOW);

    expect(await deliverMail(t.app)).toMatchObject({ sent: 1, failed: 0 });
    const mails = inbox(t.app).messagesTo(CONTACT_INBOX);
    expect(mails).toHaveLength(1);
    const mail = mails[0];
    expect(mail).toMatchObject({
      replyTo: LUCIA,
      subject: '[Contacto Cupidilla] Duda sobre mi cuenta',
    });
    expect(mail?.text).toContain('Nombre: Lucía Pérez');
    expect(mail?.text).toContain('Teléfono: No indicado');
    expect(mail?.text).toContain('Mensaje:\nHola,\nno me llega el correo.');
    expect(mail?.text).toContain('Recibido: 22 de noviembre de 2026, 11:00');
    expect(mail?.text).toContain(`Referencia: ${row?.id.slice(0, 8)}`);
    expect(mail?.text).toContain('Política de privacidad aceptada: versión 2026-11-borrador');
    expect(mail?.text).toContain('Acuse enviado al remitente: no');
    expect(mail?.text).toContain(`la respuesta irá a ${LUCIA}`);
    expect(inbox(t.app).messagesTo(LUCIA)).toEqual([]);
    const [after] = await contactRows(t.db);
    expect(after?.notified_at).not.toBeNull();
  });

  it('C3: tres mensajes al mismo buzón no se colapsan', async () => {
    for (const subject of ['Primero', 'Segundo', 'Tercero']) {
      expect((await send(contactBody({ subject }))).status).toBe(202);
      t.clock.advanceMinutes(3);
    }
    expect(await countRows(t.db, 'contact_messages')).toBe(3);
    expect(await countRows(t.db, 'email_outbox')).toBe(3);
    await deliverMail(t.app);
    expect(inbox(t.app).messagesTo(CONTACT_INBOX)).toHaveLength(3);
  });

  it('C4: el teléfono se guarda con los espacios seguidos en uno; «600-ABC» da 400', async () => {
    expect((await send(contactBody({ phone: '+34 600  11 22 33' }))).status).toBe(202);
    expect((await contactRows(t.db))[0]?.phone).toBe('+34 600 11 22 33');

    await truncateAll(t.db);
    const response = await send(contactBody({ phone: '600-ABC' }));
    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: [{ path: 'phone', issue: 'invalid_format' }],
    });
    await expectNothingSaved();
  });

  it.each(['name', 'email', 'subject', 'message', 'acceptPrivacy'])(
    'C5: sin %s da 400 required y no guarda nada',
    async (field) => {
      const body: Record<string, unknown> = contactBody();
      delete body[field];
      const response = await send(body);
      expect(response.status).toBe(400);
      expect(response.body.error.fields).toEqual([{ path: field, issue: 'required' }]);
      await expectNothingSaved();
    },
  );

  it('C6: 3000 emojis se guardan (char_length 3000); 3001 dan too_long', async () => {
    expect((await send(contactBody({ message: '😀'.repeat(3000) }))).status).toBe(202);
    expect((await contactRows(t.db))[0]?.length).toBe(3000);
    const response = await send(contactBody({ message: '😀'.repeat(3001) }));
    expect(response.status).toBe(400);
    expect(response.body.error.fields).toEqual([{ path: 'message', issue: 'too_long' }]);
  });

  it('C7: un asunto con \\r\\nBcc: da 400 invalid_format y no sale ningún correo', async () => {
    const response = await send(contactBody({ subject: 'Hola\r\nBcc: victima@example.net' }));
    expect(response.status).toBe(400);
    expect(response.body.error.fields).toEqual([{ path: 'subject', issue: 'invalid_format' }]);
    await expectNothingSaved();
  });

  it('C8: el HTML del correo interno escapa el nombre, el asunto y el mensaje', async () => {
    const message = '<script>alert(1)</script> & "x"';
    const body = contactBody({ name: '<b>Eve</b>', subject: '<i>Hola</i> & "y"', message });
    expect((await send(body)).status).toBe(202);
    await deliverMail(t.app);
    const [mail] = inbox(t.app).messagesTo(CONTACT_INBOX);
    expect(mail?.html).not.toContain('<script');
    expect(mail?.html).not.toContain('<b>Eve');
    expect(mail?.html).not.toContain('<i>Hola');
    expect(mail?.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;');
    expect(mail?.html).toContain('<title>[Contacto Cupidilla] &lt;i&gt;Hola&lt;/i&gt;');
    expect(mail?.text).toContain(message);
    expect(mail?.html).not.toMatch(/href=/);
  });

  it('C9: con el campo trampa relleno responde 202, no guarda nada y el log no lleva datos', async () => {
    const output: string[] = [];
    const capture = (chunk: unknown): boolean => {
      output.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(capture);
    vi.spyOn(process.stderr, 'write').mockImplementation(capture);

    const response = await send(contactBody({ hp_contact: 'http://spam.example' }), LUCIA_IP);
    // Ni siquiera la versión vieja da 409: el bot no aprende nada.
    const outdated = await send(
      contactBody({ hp_contact: 'x', privacyPolicyVersion: '2026-10-vieja' }),
    );
    vi.restoreAllMocks();

    expect(response.status).toBe(202);
    expect(response.text).toBe('');
    expect(outdated.status).toBe(202);
    await expectNothingSaved();
    const logs = output.join('');
    expect(logs).toContain('contact_honeypot_triggered');
    for (const value of ['spam.example', 'Lucía', 'lucia@', 'Duda sobre', LUCIA_IP]) {
      expect(logs).not.toContain(value);
    }
  });

  it('QA: con el campo trampa relleno y el resto no válido también responde 202 (no 400)', async () => {
    for (const body of [
      { hp_contact: 'http://spam.example' },
      contactBody({ hp_contact: 'x', email: 'no-es-correo', extra: 1 }),
    ]) {
      const response = await send(body);
      expect(response.status).toBe(202);
      expect(response.text).toBe('');
    }
    // Sin la trampa (o con ella vacía o de otro tipo), el cuerpo no válido sigue dando 400.
    for (const [n, hp_contact] of [undefined, '   ', 42].entries()) {
      const response = await send(contactBody({ hp_contact, email: `no-es-correo-${n}` }));
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    }
    await expectNothingSaved();
  });

  it('QA: «Acuse enviado» del correo interno es lo decidido al recibir el mensaje', async () => {
    expect((await send(contactBody())).status).toBe(202);
    const [row] = await contactRows(t.db);
    expect(row?.ack_requested).toBe(false);
    // Aunque al enviar se lea otra cosa, manda lo guardado con el mensaje.
    await t.db.execute(sql`update contact_messages set ack_requested = true`);
    await deliverMail(t.app);
    expect(inbox(t.app).messagesTo(CONTACT_INBOX)[0]?.text).toContain(
      'Acuse enviado al remitente: sí',
    );
  });

  it('C10: una versión de la política vieja da 409 PRIVACY_VERSION_OUTDATED', async () => {
    const response = await send(contactBody({ privacyPolicyVersion: '2026-10-vieja' }));
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PRIVACY_VERSION_OUTDATED');
    await expectNothingSaved();
  });

  it('C11: el 4.º mensaje de una IP en una hora da 429 con Retry-After', async () => {
    for (const n of [1, 2, 3]) {
      const body = contactBody({ email: `persona${n}@example.com` });
      expect((await send(body, LUCIA_IP)).status).toBe(202);
    }
    const response = await send(contactBody({ email: 'persona4@example.com' }), LUCIA_IP);
    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe('RATE_LIMITED');
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(await countRows(t.db, 'contact_messages')).toBe(3);
  });

  it('C12: el 4.º mensaje de un correo en 24 h da 429 aunque cambie la IP y las mayúsculas', async () => {
    for (const email of [LUCIA, 'Lucia@Example.com', 'LUCIA@example.com']) {
      expect((await send(contactBody({ email }))).status).toBe(202);
    }
    const response = await send(contactBody({ email: 'Lucia@EXAMPLE.com' }));
    expect(response.status).toBe(429);
    expect(await countRows(t.db, 'contact_messages')).toBe(3);
  });

  it('C13: tras dos fallos transitorios del SMTP, el tercer intento entrega y marca notified_at', async () => {
    expect((await send(contactBody())).status).toBe(202);
    inbox(t.app).failNext(2, { permanent: false });

    expect(await deliverMail(t.app)).toMatchObject({ retried: 1 });
    expect((await contactRows(t.db))[0]?.notified_at).toBeNull();
    t.clock.advanceMinutes(1);
    expect(await deliverMail(t.app)).toMatchObject({ retried: 1 });
    expect((await contactRows(t.db))[0]?.notified_at).toBeNull();
    t.clock.advanceMinutes(3);
    expect(await deliverMail(t.app)).toMatchObject({ sent: 1 });
    expect(inbox(t.app).messagesTo(CONTACT_INBOX)).toHaveLength(1);
    expect((await contactRows(t.db))[0]?.notified_at).not.toBeNull();
  });

  it('T6: si el mensaje se borra antes de enviar, la fila del outbox cae en cascada y no sale nada', async () => {
    expect((await send(contactBody())).status).toBe(202);
    await t.db.execute(sql`delete from contact_messages`);
    expect(await countRows(t.db, 'email_outbox')).toBe(0);
    expect(await deliverMail(t.app)).toMatchObject({ sent: 0 });
    expect(inbox(t.app).messages).toEqual([]);
  });

  it('T6: si el mensaje desaparece tras el reclamo, el correo se descarta (skipped)', async () => {
    expect((await send(contactBody())).status).toBe(202);
    // El mensaje se borra cuando el worker ya ha reclamado la fila, justo antes de resolverla.
    const resolver = t.app.get(MailResolver);
    const resolve = resolver.resolve.bind(resolver);
    vi.spyOn(resolver, 'resolve').mockImplementationOnce(async (tx, row) => {
      await t.db.execute(sql`delete from contact_messages`);
      return resolve(tx, row);
    });
    expect(await deliverMail(t.app)).toMatchObject({ sent: 0, skipped: 1 });
    expect(inbox(t.app).messages).toEqual([]);
  });

  it('un campo desconocido da 400 unrecognized; sin la clave interna, 403', async () => {
    const response = await send(contactBody({ website: 'x' }));
    expect(response.status).toBe(400);
    expect(response.body.error.fields).toEqual([{ path: '', issue: 'unrecognized' }]);
    const anonymous = await request(t.app.getHttpServer()).post('/contact').send(contactBody());
    expect(anonymous.status).toBe(403);
    await expectNothingSaved();
  });

  it('C15: borrar cuentas no toca los correos de contacto pendientes ni los mensajes', async () => {
    const ana = await registerUser(t.app, { email: 'ana@example.com' });
    await registerUser(t.app, { email: CONTACT_INBOX }, { verified: false });
    inbox(t.app).clear();
    expect((await send(contactBody({ email: ana.email }))).status).toBe(202);
    const [message] = await contactRows(t.db);
    // El acuse de Ana, como si CONTACT_ACK_EMAIL estuviera activado al recibirlo.
    await t.app
      .get(OutboxService)
      .enqueueContact(t.db, 'contact_ack', ana.email, message?.id ?? '');

    const deletion = await api(t.app)
      .post('/users/me/deletion')
      .set('Authorization', `Bearer ${ana.token}`)
      .send({ password: ana.password });
    expect(deletion.status).toBe(204);
    // La cuenta de contacto@example.com, sin confirmar, la borra el barrido a los 7 días.
    t.clock.advanceDays(8);
    expect(await t.app.get(UnverifiedAccountsSweeper).sweep()).toMatchObject({ deleted: 1 });

    expect(await countRows(t.db, 'users')).toBe(0);
    expect(await countRows(t.db, 'contact_messages')).toBe(1);
    const kinds = await t.db
      .select({ kind: emailOutbox.kind })
      .from(emailOutbox)
      .where(eq(emailOutbox.contactMessageId, message?.id ?? ''));
    expect(kinds.map((row) => row.kind).sort()).toEqual(['contact_ack', 'contact_message']);
  });
});
