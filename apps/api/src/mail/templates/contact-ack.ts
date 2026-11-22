import { renderMail, type MailContext, type RenderedMail } from './layout.js';
import { contactReference } from './contact-message.js';

/**
 * Acuse al remitente del formulario de contacto (UX de contacto §6.2, técnico A6). No repite nada
 * de lo escrito (ni nombre, ni asunto, ni mensaje): va a una dirección que escribe quien rellena
 * el formulario. Sin botones ni enlaces.
 */
export function renderContactAck(
  context: MailContext,
  input: { id: string; email: string },
): RenderedMail {
  return renderMail(context, {
    subject: 'Hemos recibido tu mensaje',
    heading: 'Hemos recibido tu mensaje',
    blocks: [
      {
        type: 'p',
        text: `Alguien ha enviado un mensaje desde el formulario de contacto de Cupidilla con este correo (${input.email}). Si has sido tú, no tienes que hacer nada más: lo leeremos y te contestaremos a esta misma dirección.`,
      },
      { type: 'p', text: `Referencia: ${contactReference(input.id)}` },
      { type: 'p', text: 'Por seguridad, este correo no repite lo que escribiste.' },
      {
        type: 'strong',
        text: `Si no has sido tú, ignora este mensaje: no se ha creado ninguna cuenta ni se hará nada con tu correo, aparte de atender ese mensaje. Si quieres que lo borremos, escribe a ${context.supportAddress} indicando la referencia.`,
      },
    ],
  });
}
