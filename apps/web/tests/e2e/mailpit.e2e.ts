import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { clearMailTo, linkIn, mailTo, mailpitSmtpUrl, waitForMail } from './helpers/mailpit.ts';
import { WEB_URL } from './helpers/oauth-env.ts';

test('A6-2: waitForMail, linkIn y clearMailTo solo ven a su destinatario', async () => {
  const first = `e2e+${randomUUID()}@example.com`;
  const second = `e2e+${randomUUID()}@example.com`;
  const token = (char: string) => char.repeat(43);
  const transport = nodemailer.createTransport(mailpitSmtpUrl());
  try {
    for (const [to, char] of [
      [first, 'a'],
      [second, 'b'],
    ] as const) {
      await transport.sendMail({
        from: 'Cupidilla <no-reply@example.com>',
        to,
        subject: 'Prueba de Mailpit',
        text: `Abre este enlace:\n\n${WEB_URL}/verify-email?token=${token(char)}\n`,
      });
    }
  } finally {
    transport.close();
  }

  try {
    const message = await waitForMail(second, { subject: 'Prueba de Mailpit' });
    expect(message.To.map((recipient) => recipient.Address)).toEqual([second]);
    expect(await mailTo(second)).toHaveLength(1);
    expect(await linkIn(message, '/verify-email')).toBe(
      `${WEB_URL}/verify-email?token=${token('b')}`,
    );

    await clearMailTo(second);
    expect(await mailTo(second)).toEqual([]);
    expect(await mailTo(first)).toHaveLength(1);
  } finally {
    await clearMailTo(first);
    await clearMailTo(second);
  }
});
