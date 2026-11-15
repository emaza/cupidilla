/** Un correo ya renderizado: texto plano y HTML con las mismas palabras (UX §5). */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Puerto de envío (correo §4.1). Clase abstracta para que sirva de token de inyección:
 * `SmtpMailer` en desarrollo y producción, `MemoryMailer` en los tests de integración.
 */
export abstract class Mailer {
  abstract send(message: MailMessage): Promise<void>;
}

/**
 * Fallo al entregar. `permanent`: no tiene sentido reintentar (5xx salvo 503, sobre mal formado).
 * `code` es solo un código (`smtp_550`, `ESOCKET`), nunca la respuesta del servidor.
 */
export class MailDeliveryError extends Error {
  constructor(
    readonly permanent: boolean,
    readonly code: string,
  ) {
    super(`mail delivery failed: ${code}`);
  }
}
