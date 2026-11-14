import { PASSWORD_RESET_TTL_MINUTES } from '@cupidilla/contracts';
import { durationText, renderMail, type MailContext, type RenderedMail } from './layout.js';

/** «Restablece tu contraseña» (UX §5.2). */
export function renderResetPassword(
  context: MailContext,
  input: { email: string; link: string },
): RenderedMail {
  return renderMail(context, {
    subject: 'Restablece tu contraseña',
    heading: 'Restablece tu contraseña',
    blocks: [
      {
        type: 'p',
        text: `Alguien ha pedido crear una contraseña nueva para la cuenta de Cupidilla con este correo (${input.email}). Si has sido tú, abre este enlace:`,
      },
      { type: 'action', label: 'Crear una contraseña nueva', url: input.link },
      {
        type: 'p',
        text: `El enlace caduca en ${durationText(PASSWORD_RESET_TTL_MINUTES)} y solo sirve una vez. Si pides otro, este deja de funcionar.`,
      },
      {
        type: 'p',
        text: 'Al guardar la contraseña nueva cerraremos las demás sesiones de tu cuenta. Si tu cuenta solo entraba con Google o Facebook, así podrás añadirle una contraseña.',
      },
      {
        type: 'strong',
        text: 'Si no has sido tú, ignora este mensaje: tu contraseña no cambia mientras nadie abra el enlace y escriba una nueva. No compartas este enlace con nadie; con él se puede entrar en tu cuenta. Nunca te pediremos tu contraseña por correo.',
      },
    ],
  });
}
