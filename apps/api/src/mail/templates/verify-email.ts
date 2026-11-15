import { EMAIL_VERIFICATION_TTL_HOURS, formatSpanishDate } from '@cupidilla/contracts';
import { durationText, renderMail, type MailContext, type RenderedMail } from './layout.js';

export interface VerifyEmailInput {
  email: string;
  /** Enlace completo con el token. */
  link: string;
  /** `created_at + 7 días`: cuándo se borra la cuenta si nadie la confirma. */
  deletionAt: Date;
}

/** «Confirma tu correo» (UX §5.1). */
export function renderVerifyEmail(context: MailContext, input: VerifyEmailInput): RenderedMail {
  const duration = durationText(EMAIL_VERIFICATION_TTL_HOURS * 60);
  return renderMail(context, {
    subject: 'Confirma tu correo',
    heading: 'Confirma tu correo',
    blocks: [
      {
        type: 'p',
        text: `Alguien ha creado una cuenta de Cupidilla con este correo (${input.email}). Si has sido tú, confírmalo para terminar:`,
      },
      { type: 'action', label: 'Confirmar mi correo', url: input.link },
      {
        type: 'p',
        text: `Al abrir el enlace tendrás que escribir la contraseña de la cuenta (la que elegiste al crearla) y pulsar un botón. El enlace caduca en ${duration} y solo sirve una vez. Si pides otro mensaje, este deja de funcionar.`,
      },
      {
        type: 'strong',
        text: `Si no has sido tú, no hagas nada: ignora este mensaje. Tu correo no se usará para nada más y, si nadie lo confirma, la cuenta se borra sola el ${formatSpanishDate(input.deletionAt)}. Si quieres quedarte con tu correo antes de esa fecha, crea una contraseña nueva en ${context.webUrl}/forgot-password.`,
      },
    ],
  });
}
