import nodemailer from 'nodemailer';
import { describe, expect, it } from 'vitest';
import { emailHint } from './email-tokens.service.js';
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

  it('A4-14: emailHint enmascara el correo', () => {
    expect(emailHint('beto@example.com')).toBe('b•••@example.com');
  });
});
