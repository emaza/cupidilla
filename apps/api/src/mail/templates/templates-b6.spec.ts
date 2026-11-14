import { describe, expect, it } from 'vitest';
import type { MailContext } from './layout.js';
import { renderSignupNotice } from './signup-notice.js';
import { renderVerifyEmail } from './verify-email.js';
import { renderVerifyReminder } from './verify-reminder.js';

const context: MailContext = {
  webUrl: 'http://localhost:5173',
  supportAddress: 'soporte@example.com',
};
const LINK = `http://localhost:5173/verify-email?token=${'a'.repeat(43)}`;
const DELETION = new Date('2026-11-18T10:00:00Z');

describe('B6-1: «Confirma tu correo»', () => {
  const mail = renderVerifyEmail(context, {
    email: 'beto@example.com',
    link: LINK,
    deletionAt: DELETION,
  });

  it('asunto, enlace solo en su línea, «24 horas» y la fecha de borrado', () => {
    expect(mail.subject).toBe('Confirma tu correo');
    expect(mail.text.split('\n')).toContain(LINK);
    expect(mail.text).toContain('24 horas');
    expect(mail.text).toContain('18 de noviembre de 2026');
  });

  it('el HTML lleva el enlace dos veces: botón y texto', () => {
    expect(mail.html.split(LINK)).toHaveLength(3);
    expect(mail.html).toContain(`<a href="${LINK}"`);
  });
});

describe('B6-2: los valores interpolados van escapados en el HTML', () => {
  const email = 'be<b>to@example.com';
  const renders = [
    renderVerifyEmail(context, { email, link: LINK, deletionAt: DELETION }),
    renderVerifyReminder(context, { email, link: LINK, deletionAt: DELETION }),
    renderSignupNotice(context, { variant: 'verified', email }),
    renderSignupNotice(context, { variant: 'unverified', email, deletionAt: DELETION }),
    renderSignupNotice(context, { variant: 'provider', email, providers: ['google'] }),
  ];

  it.each(renders.map((mail, index) => [index, mail] as const))('plantilla %i', (_, mail) => {
    expect(mail.html).not.toContain('<b>');
    expect(mail.html).toContain('be&lt;b&gt;to@example.com');
  });
});
