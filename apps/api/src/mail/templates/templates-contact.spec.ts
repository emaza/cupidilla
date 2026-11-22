import { describe, expect, it } from 'vitest';
import { renderContactAck } from './contact-ack.js';
import { formatSpanishDateTime, renderContactMessage } from './contact-message.js';
import type { MailContext } from './layout.js';

const context: MailContext = {
  webUrl: 'http://localhost:5173',
  supportAddress: 'soporte@example.com',
};
const id = '0f3c2a91-1111-4222-8333-944445555666';
const hostile = {
  id,
  name: '<b>Eve</b> & "Mallory"',
  email: 'eve@example.com',
  phone: null,
  subject: '<script>alert(1)</script> & "x"',
  message: 'Línea 1 <img src=x onerror=alert(1)>\nLínea 2 & "comillas" \'simples\'',
  createdAt: new Date('2026-11-22T10:15:00Z'),
  privacyPolicyVersion: '2026-11-borrador',
  ackSent: false,
};

describe('T5: plantilla del correo interno de contacto (UX de contacto §6.1)', () => {
  const mail = renderContactMessage(context, hostile);

  it('el nombre, el asunto y el mensaje salen escapados en el HTML, también en el <title>', () => {
    expect(mail.html).not.toContain('<b>Eve');
    expect(mail.html).not.toContain('<script');
    expect(mail.html).not.toContain('<img');
    expect(mail.html).toContain('&lt;b&gt;Eve&lt;/b&gt; &amp; &quot;Mallory&quot;');
    expect(mail.html).toContain(
      '<title>[Contacto Cupidilla] &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;</title>',
    );
    expect(mail.html).toContain('&#39;simples&#39;');
  });

  it('el texto plano los lleva literales y conserva los saltos de línea', () => {
    expect(mail.subject).toBe('[Contacto Cupidilla] <script>alert(1)</script> & "x"');
    expect(mail.text).toContain(`Mensaje:\n${hostile.message}`);
    expect(mail.html).toMatch(/white-space:pre-wrap[^>]*>Línea 1 &lt;img[^<]*\nLínea 2/);
  });

  it('lleva los datos de §6.1 y ningún enlace', () => {
    expect(mail.text).toContain('Nuevo mensaje de contacto');
    expect(mail.text).toContain('Teléfono: No indicado');
    expect(mail.text).toContain('Recibido: 22 de noviembre de 2026, 11:15');
    expect(mail.text).toContain('Referencia: 0f3c2a91');
    expect(mail.text).toContain('Acuse enviado al remitente: no');
    expect(mail.text).toContain(
      'Para contestar, usa «Responder»: la respuesta irá a eve@example.com.',
    );
    expect(mail.html).not.toMatch(/href=|mailto:/);
    expect(
      renderContactMessage(context, { ...hostile, phone: '+34 600 11 22 33', ackSent: true }).text,
    ).toMatch(/Teléfono: \+34 600 11 22 33\n[\s\S]*Acuse enviado al remitente: sí/);
  });

  it('R-C2: avisa antes del mensaje y lleva su pie propio, no el común', () => {
    const warning = 'Texto escrito por quien envía el formulario: no abras enlaces que no esperes.';
    expect(mail.text).toContain(`${warning}\n\nMensaje:\n`);
    expect(mail.html).toContain(`<strong>${warning}</strong>`);
    expect(mail.html.indexOf(warning)).toBeLessThan(mail.html.indexOf('Línea 1'));
    const footer =
      'Mensaje del formulario de contacto de Cupidilla. Si respondes a este correo, la respuesta le llega a eve@example.com.';
    expect(mail.text.endsWith(`${footer}\n`)).toBe(true);
    expect(mail.html).toContain(footer);
    expect(mail.text).not.toContain('no hace falta que lo respondas');
  });

  it('un asunto con saltos de línea sale en una sola línea', () => {
    expect(renderContactMessage(context, { ...hostile, subject: 'Hola\r\nBcc: x' }).subject).toBe(
      '[Contacto Cupidilla] Hola Bcc: x',
    );
  });

  it('la fecha y la hora van en Europe/Madrid', () => {
    expect(formatSpanishDateTime(new Date('2026-07-01T22:05:00Z'))).toBe(
      '2 de julio de 2026, 00:05',
    );
  });
});

describe('T5: plantilla del acuse (UX de contacto §6.2, técnico A6)', () => {
  const mail = renderContactAck(context, { id, email: 'lucia@example.com' });

  it('asunto, referencia y pie común, sin botones ni enlaces', () => {
    expect(mail.subject).toBe('Hemos recibido tu mensaje');
    expect(mail.text).toContain('Referencia: 0f3c2a91');
    expect(mail.text).toContain('con este correo (lucia@example.com)');
    expect(mail.text).toContain('Por seguridad, este correo no repite lo que escribiste.');
    expect(mail.text).toContain('escribe a soporte@example.com indicando la referencia');
    expect(mail.text).toMatch(/Si necesitas ayuda, escribe a soporte@example\.com\.\n$/);
    expect(mail.html).not.toMatch(/href=/);
  });

  it('la plantilla no recibe nada de lo escrito: ni nombre, ni asunto, ni mensaje', () => {
    expect(renderContactAck.length).toBe(2);
    for (const written of [hostile.name, hostile.subject, 'Línea 1']) {
      expect(mail.text).not.toContain(written);
    }
  });
});
