import { describe, expect, it } from 'vitest';
import type { MailContext } from './layout.js';
import { renderResetPassword } from './reset-password.js';
import { renderSignupNotice } from './signup-notice.js';
import { renderVerifyEmail } from './verify-email.js';

const context: MailContext = {
  webUrl: 'http://localhost:5173',
  supportAddress: 'soporte@example.com',
};
const hostile = '"><script>alert(1)</script>@example.com';

describe('QA: escapado del HTML de las plantillas', () => {
  it('el correo del destinatario y el enlace nunca llegan al HTML sin escapar', () => {
    const mails = [
      renderVerifyEmail(context, {
        email: hostile,
        link: `${context.webUrl}/verify-email?token="><img src=x>`,
        deletionAt: new Date('2026-11-18T10:00:00Z'),
      }),
      renderResetPassword(context, { email: hostile, link: 'http://localhost:5173/x?a=1&b="2"' }),
      renderSignupNotice(context, { variant: 'verified', email: hostile }),
      renderSignupNotice(context, {
        variant: 'unverified',
        email: hostile,
        deletionAt: new Date('2026-11-18T10:00:00Z'),
      }),
      renderSignupNotice(context, { variant: 'provider', email: hostile, providers: ['google'] }),
    ];
    for (const mail of mails) {
      expect(mail.html).not.toContain('<script');
      expect(mail.html).not.toContain('<img');
      expect(mail.html).not.toMatch(/href="[^"]*"[^>]*"[^>]*>[^<]*<script/);
    }
  });
});
