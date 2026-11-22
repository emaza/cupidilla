import { formatSpanishDate, REFERENCE_TIME_ZONE } from '@cupidilla/contracts';
import { renderMail, type MailContext, type RenderedMail } from './layout.js';

export interface ContactMessageInput {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string;
  message: string;
  createdAt: Date;
  privacyPolicyVersion: string;
  /** Si se encoló el acuse al remitente al recibir el mensaje (`contact_messages.ack_requested`). */
  ackSent: boolean;
}

/** Referencia corta y opaca de un mensaje (la misma en el correo interno y en el acuse). */
export const contactReference = (id: string): string => id.slice(0, 8);

/** «22 de noviembre de 2026, 11:15», en Europe/Madrid. */
export function formatSpanishDateTime(instant: Date): string {
  const time = new Intl.DateTimeFormat('es-ES', {
    timeZone: REFERENCE_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
  return `${formatSpanishDate(instant)}, ${time}`;
}

/** Sin saltos de línea: el asunto va en una cabecera (UX de contacto §6.1). */
const oneLine = (value: string): string => value.replace(/[\r\n]+/g, ' ');

/**
 * Correo interno al buzón de contacto (UX de contacto §6.1, con el aviso y el pie del técnico
 * §4.4). `Reply-To` lo pone el
 * resolver. Todo valor de la persona pasa por `escapeHtml` en el layout; no se crea ningún enlace
 * con lo que escribe, tampoco un `mailto:`. Nunca lleva IP ni datos de la sesión.
 */
export function renderContactMessage(
  context: MailContext,
  input: ContactMessageInput,
): RenderedMail {
  const subject = oneLine(input.subject);
  return renderMail(context, {
    subject: `[Contacto Cupidilla] ${subject}`,
    heading: 'Nuevo mensaje de contacto',
    blocks: [
      {
        type: 'fields',
        rows: [
          ['Nombre', input.name],
          ['Correo', input.email],
          ['Teléfono', input.phone ?? 'No indicado'],
          ['Asunto', subject],
          ['Recibido', formatSpanishDateTime(input.createdAt)],
          ['Referencia', contactReference(input.id)],
          ['Política de privacidad aceptada', `versión ${input.privacyPolicyVersion}`],
          ['Acuse enviado al remitente', input.ackSent ? 'sí' : 'no'],
        ],
      },
      // Aviso antes del texto ajeno (técnico de contacto §4.4, R-C2): riesgo de phishing.
      {
        type: 'strong',
        text: 'Texto escrito por quien envía el formulario: no abras enlaces que no esperes.',
      },
      { type: 'quote', label: 'Mensaje:', text: input.message },
      {
        type: 'p',
        text: `Para contestar, usa «Responder»: la respuesta irá a ${input.email}.`,
      },
    ],
    // No vale el pie común («no hace falta que lo respondas»): este correo se responde.
    footer: `Mensaje del formulario de contacto de Cupidilla. Si respondes a este correo, la respuesta le llega a ${input.email}.`,
  });
}
