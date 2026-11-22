import nodemailer from 'nodemailer';
import { describe, expect, it } from 'vitest';
import { emailHint } from './email-tokens.service.js';
import { MailDeliveryError } from './mailer.js';
import { classifySmtpError, mailOptions, smtpTransportOptions } from './smtp.mailer.js';
import { escapeHtml } from './templates/layout.js';

describe('smtpTransportOptions (correo §8.1)', () => {
  it('A1-10: smtp: fuera de loopback → 587, STARTTLS obligatorio y credenciales decodificadas', () => {
    const options = smtpTransportOptions('smtp://u%40x:cl%3Ave@mail.proveedor.eu');
    expect(options).toMatchObject({
      host: 'mail.proveedor.eu',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'u@x', pass: 'cl:ve' },
      tls: { rejectUnauthorized: true },
    });
  });

  it('A1-11: smtps: → 465 y TLS implícito; smtp: en loopback no exige STARTTLS', () => {
    expect(smtpTransportOptions('smtps://mail.proveedor.eu')).toMatchObject({
      port: 465,
      secure: true,
    });
    expect(smtpTransportOptions('smtps://mail.proveedor.eu').auth).toBeUndefined();
    expect(smtpTransportOptions('smtp://127.0.0.1:1025')).toMatchObject({
      host: '127.0.0.1',
      port: 1025,
      secure: false,
      requireTLS: false,
    });
  });
});

describe('classifySmtpError (correo §4.1)', () => {
  it('A4-12: EENVELOPE y los 5xx con permanent son permanentes', () => {
    expect(classifySmtpError({ code: 'EENVELOPE' })).toMatchObject({
      permanent: true,
      code: 'EENVELOPE',
    });
    expect(classifySmtpError({ responseCode: 550, permanent: true })).toMatchObject({
      permanent: true,
      code: 'smtp_550',
    });
  });

  it.each([
    [{ responseCode: 421, permanent: false }, 'smtp_421'],
    [{ code: 'EAUTH' }, 'EAUTH'],
    [{ code: 'ETLS' }, 'ETLS'],
    [{ code: 'ESOCKET' }, 'ESOCKET'],
  ])('A4-12: %j es transitorio', (error, code) => {
    expect(classifySmtpError(error)).toMatchObject({ permanent: false, code });
  });

  it('EAUTH/ETLS no son permanentes aunque nodemailer ponga permanent: true', () => {
    expect(classifySmtpError({ code: 'EAUTH', responseCode: 535, permanent: true })).toMatchObject({
      permanent: false,
      code: 'smtp_535',
    });
    expect(classifySmtpError({ code: 'ETLS', permanent: true })).toMatchObject({
      permanent: false,
      code: 'ETLS',
    });
  });

  it('EENVELOPE respeta permanent: false (450); sin clasificación SMTP es permanente', () => {
    expect(
      classifySmtpError({ code: 'EENVELOPE', responseCode: 450, permanent: false }),
    ).toMatchObject({ permanent: false, code: 'smtp_450' });
    expect(
      classifySmtpError({ code: 'EENVELOPE', responseCode: 550, permanent: true }),
    ).toMatchObject({
      permanent: true,
    });
    expect(classifySmtpError({ code: 'EENVELOPE' })).toMatchObject({ permanent: true });
  });

  it('nunca copia el mensaje del error', () => {
    const error = Object.assign(new Error('550 5.1.1 <beto@example.com>: no existe'), {
      code: 'EMESSAGE',
      responseCode: 550,
      permanent: true,
    });
    expect(classifySmtpError(error).message).not.toContain('beto@example.com');
  });
});

describe('formato del mensaje (correo §4.1, §4.5)', () => {
  it('A4-13: Auto-Submitted y multipart/alternative; escapeHtml', async () => {
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const info = await transport.sendMail(
      mailOptions('Cupidilla <no-reply@example.com>', {
        to: 'beto@example.com',
        subject: 'Confirma tu correo',
        text: 'Hola',
        html: '<p>Hola</p>',
      }),
    );
    const raw = info.message.toString();
    expect(raw).toMatch(/^From: Cupidilla <no-reply@example\.com>\r?$/m);
    expect(raw).toMatch(/^Auto-Submitted: auto-generated\r?$/m);
    expect(raw).toMatch(/^Content-Type: multipart\/alternative;/m);

    expect(escapeHtml('<b>&"')).toBe('&lt;b&gt;&amp;&quot;');
  });

  it('T4: Reply-To sale como una sola dirección, sin nombre', async () => {
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const info = await transport.sendMail(
      mailOptions('Cupidilla <no-reply@example.com>', {
        to: 'contacto@example.com',
        subject: '[Contacto Cupidilla] Duda',
        text: 'Hola',
        html: '<p>Hola</p>',
        replyTo: 'ana@example.com',
      }),
    );
    const raw = info.message.toString();
    expect(raw).toMatch(/^Reply-To: ana@example\.com\r?$/m);
    expect(info.envelope.to).toEqual(['contacto@example.com']);
    // Sin replyTo, no hay cabecera.
    expect(
      mailOptions('no-reply@example.com', {
        to: 'a@example.com',
        subject: 's',
        text: '',
        html: '',
      }),
    ).not.toHaveProperty('replyTo');
  });

  it('T4: un subject, un to o un replyTo con saltos o controles lanzan header_unsafe permanente', () => {
    const base = { to: 'contacto@example.com', subject: 'Hola', text: '', html: '' };
    const bad = [
      { ...base, subject: 'Hola\r\nBcc: victima@example.net' },
      { ...base, subject: `Hola${String.fromCodePoint(0x2028)}Bcc` },
      { ...base, to: 'contacto@example.com\nBcc: victima@example.net' },
      { ...base, replyTo: 'ana@example.com\nBcc: victima@example.net' },
    ];
    for (const message of bad) {
      let thrown: unknown;
      try {
        mailOptions('no-reply@example.com', message);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(MailDeliveryError);
      expect(thrown).toMatchObject({ permanent: true, code: 'header_unsafe' });
    }
  });

  it('A4-14: emailHint enmascara el correo', () => {
    expect(emailHint('beto@example.com')).toBe('b•••@example.com');
  });
});
