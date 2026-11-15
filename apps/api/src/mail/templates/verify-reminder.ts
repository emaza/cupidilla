import { EMAIL_VERIFICATION_TTL_HOURS, formatSpanishDate } from '@cupidilla/contracts';
import { durationText, renderMail, type MailContext, type RenderedMail } from './layout.js';
import type { VerifyEmailInput } from './verify-email.js';

/** «Confirma tu correo o borraremos tu cuenta», el 5.º día (UX §5.4). */
export function renderVerifyReminder(context: MailContext, input: VerifyEmailInput): RenderedMail {
  const duration = durationText(EMAIL_VERIFICATION_TTL_HOURS * 60);
  return renderMail(context, {
    subject: 'Confirma tu correo o borraremos tu cuenta',
    heading: 'Tu cuenta se borrará pronto',
    blocks: [
      {
        type: 'p',
        text: `Creaste una cuenta de Cupidilla con este correo (${input.email}) y todavía no lo has confirmado. Si no lo confirmas, la borraremos el ${formatSpanishDate(input.deletionAt)}, con todo lo que hay en ella.`,
      },
      { type: 'p', text: 'Para conservarla, confirma tu correo:' },
      { type: 'action', label: 'Confirmar mi correo', url: input.link },
      {
        type: 'p',
        text: `Al abrir el enlace tendrás que escribir la contraseña de la cuenta y pulsar un botón. El enlace caduca en ${duration} y solo sirve una vez. Si pides otro mensaje, este deja de funcionar.`,
      },
      {
        type: 'strong',
        text: `Si no has sido tú, no hagas nada: la cuenta se borrará sola y tu correo no se usará para nada más. Si quieres quedarte con tu correo antes de esa fecha, crea una contraseña nueva en ${context.webUrl}/forgot-password. Si tienes dudas, escribe a ${context.supportAddress}.`,
      },
    ],
  });
}
