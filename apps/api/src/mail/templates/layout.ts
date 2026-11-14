/**
 * Esqueleto común de los correos (UX §5): texto plano y HTML con las mismas palabras, estilos en
 * línea, sin imágenes ni recursos remotos y con el pie fijo. Todo valor interpolado en el HTML
 * pasa por `escapeHtml`.
 */

/** Lo que cada plantilla necesita de la configuración. Los enlaces salen solo de aquí (R-M10). */
export interface MailContext {
  /** `PUBLIC_WEB_URL`, sin barra final. */
  webUrl: string;
  /** `MAIL_SUPPORT_ADDRESS`. */
  supportAddress: string;
}

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

/** Bloques del cuerpo, en orden. */
export type MailBlock =
  /** Párrafo normal. */
  | { type: 'p'; text: string }
  /** Párrafo destacado (qué hacer si no fuiste tú). */
  | { type: 'strong'; text: string }
  /**
   * Enlace de acción: en HTML, un botón y debajo la URL en texto visible; en texto plano, la URL
   * sola en su línea. `secondary`: botón con borde en vez de fondo.
   */
  | { type: 'action'; label: string; url: string; secondary?: boolean };

const BRAND = '#6b2d5c';

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Pie fijo, igual en los cinco correos (UX §5). */
export const footerText = (context: MailContext): string =>
  `Cupidilla. Este mensaje es automático; no hace falta que lo respondas. Si necesitas ayuda, escribe a ${context.supportAddress}.`;

function blockText(block: MailBlock): string {
  return block.type === 'action' ? block.url : block.text;
}

function blockHtml(block: MailBlock): string {
  switch (block.type) {
    case 'p':
      return `<p style="margin:0 0 16px">${escapeHtml(block.text)}</p>`;
    case 'strong':
      return `<p style="margin:0 0 16px"><strong>${escapeHtml(block.text)}</strong></p>`;
    case 'action': {
      const style = block.secondary
        ? `display:inline-block;background:#ffffff;color:${BRAND};border:2px solid ${BRAND};padding:10px 18px;text-decoration:none;font-weight:bold`
        : `display:inline-block;background:${BRAND};color:#ffffff;padding:12px 20px;text-decoration:none;font-weight:bold`;
      const url = escapeHtml(block.url);
      return (
        `<p style="margin:0 0 16px"><a href="${url}" style="${style}">${escapeHtml(block.label)}</a></p>` +
        `<p style="margin:0 0 16px;font-size:14px">Si el botón no funciona, copia esta dirección en tu navegador:<br>` +
        `<span style="word-break:break-all">${url}</span></p>`
      );
    }
  }
}

/** Monta el correo completo: asunto, titular, bloques y pie, en texto plano y en HTML. */
export function renderMail(
  context: MailContext,
  mail: { subject: string; heading: string; blocks: MailBlock[] },
): RenderedMail {
  const footer = footerText(context);
  const text = [mail.heading, ...mail.blocks.map(blockText), footer].join('\n\n') + '\n';
  const html = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(mail.subject)}</title></head>
<body style="margin:0;background:#f7f4f2;color:#1e1b1d;font:16px/1.5 Arial,Helvetica,sans-serif">
<table role="presentation" width="100%"><tr><td align="center" style="padding:24px 12px">
<div style="max-width:600px;background:#ffffff;padding:24px;text-align:left">
<p style="margin:0 0 16px;font-weight:bold;color:${BRAND}">Cupidilla</p>
<h1 style="margin:0 0 16px;font-size:22px">${escapeHtml(mail.heading)}</h1>
${mail.blocks.map(blockHtml).join('\n')}
</div>
<p style="font-size:13px;color:#5b5558">${escapeHtml(footer)}</p>
</td></tr></table>
</body></html>
`;
  return { subject: mail.subject, text, html };
}

/** «24 horas», «1 hora», «30 minutos»: los plazos salen de las constantes, no del texto. */
export function durationText(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  }
  return `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
}
