import { renderMail, type MailContext, type RenderedMail } from './layout.js';

/** «Tu contraseña ha cambiado» (UX §5.5). Sin token, hora, dispositivo ni contraseña. */
export function renderPasswordChanged(
  context: MailContext,
  input: { email: string },
): RenderedMail {
  return renderMail(context, {
    subject: 'Tu contraseña ha cambiado',
    heading: 'Hemos cambiado tu contraseña',
    blocks: [
      {
        type: 'p',
        text: `Se ha guardado una contraseña nueva en la cuenta de Cupidilla con este correo (${input.email}) y hemos cerrado las demás sesiones abiertas de tu cuenta.`,
      },
      { type: 'p', text: 'Si has sido tú, no tienes que hacer nada más.' },
      {
        type: 'strong',
        text: 'Si no has sido tú, alguien ha podido abrir un enlace de tu correo. Haz esto ya:',
      },
      {
        type: 'p',
        text: '1. Crea otra contraseña ahora, para que la de esa persona deje de valer y se cierren sus sesiones:',
      },
      {
        type: 'action',
        label: 'Recuperar mi cuenta',
        url: `${context.webUrl}/forgot-password`,
      },
      {
        type: 'p',
        text: '2. Revisa la seguridad de tu correo: cambia su contraseña si crees que otra persona puede entrar.',
      },
      {
        type: 'p',
        text: `3. Si no puedes entrar o tienes dudas, escribe a ${context.supportAddress}.`,
      },
    ],
  });
}
