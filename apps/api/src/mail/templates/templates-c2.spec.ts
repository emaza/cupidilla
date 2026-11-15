import { describe, expect, it } from 'vitest';
import type { MailContext } from './layout.js';
import { renderPasswordChanged } from './password-changed.js';
import { renderResetPassword } from './reset-password.js';

const context: MailContext = {
  webUrl: 'http://localhost:5173',
  supportAddress: 'soporte@example.com',
};
const LINK = `http://localhost:5173/reset-password?token=${'a'.repeat(43)}`;

describe('plantillas de la recuperación (C.2)', () => {
  it('«Restablece tu contraseña»: enlace solo en su línea, dos veces en el HTML, y 1 hora', () => {
    const mail = renderResetPassword(context, { email: 'ana@example.com', link: LINK });
    expect(mail.subject).toBe('Restablece tu contraseña');
    expect(mail.text.split('\n')).toContain(LINK);
    expect(mail.text).toContain('El enlace caduca en 1 hora');
    expect(mail.html.split(LINK).length - 1).toBe(2);
    expect(mail.html).not.toContain('<img');
  });

  it('«Tu contraseña ha cambiado»: sin token, con /forgot-password y el soporte', () => {
    const mail = renderPasswordChanged(context, { email: 'ana@example.com' });
    expect(mail.subject).toBe('Tu contraseña ha cambiado');
    expect(mail.text).not.toContain('token=');
    expect(mail.html).not.toContain('token=');
    expect(mail.text.split('\n')).toContain('http://localhost:5173/forgot-password');
    expect(mail.text).toContain(
      '3. Si no puedes entrar o tienes dudas, escribe a soporte@example.com.',
    );
  });
});
