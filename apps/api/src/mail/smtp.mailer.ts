import nodemailer, {
  type SendMailOptions,
  type SMTPTransportOptions,
  type Transporter,
} from 'nodemailer';
import { isLoopbackUrl } from '../config/env.schema.js';
import { MailDeliveryError, Mailer, type MailMessage } from './mailer.js';

/** Límites de la conexión SMTP (correo §4.1). Sin *pool*: pocas decenas de correos al día. */
const CONNECTION_TIMEOUT_MS = 5000;
const GREETING_TIMEOUT_MS = 5000;
const SOCKET_TIMEOUT_MS = 15_000;

/**
 * Opciones de nodemailer a partir de `SMTP_URL` (correo §8.1):
 * - `smtps:` → TLS implícito (`secure`), puerto 465 por defecto.
 * - `smtp:` → puerto 587 por defecto y STARTTLS obligatorio (`requireTLS`) salvo en loopback:
 *   sin él, falla en vez de enviar en claro.
 * Usuario y clave salen de la URL, decodificados. El certificado se comprueba siempre.
 */
export function smtpTransportOptions(smtpUrl: string): SMTPTransportOptions {
  const url = new URL(smtpUrl);
  const secure = url.protocol === 'smtps:';
  // `[::1]` en la URL; nodemailer quiere la dirección sin corchetes.
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  const options: SMTPTransportOptions = {
    host,
    port: url.port ? Number(url.port) : secure ? 465 : 587,
    secure,
    requireTLS: !secure && !isLoopbackUrl(smtpUrl),
    tls: { rejectUnauthorized: true },
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  };
  if (url.username || url.password) {
    options.auth = {
      user: decodeURIComponent(url.username),
      pass: decodeURIComponent(url.password),
    };
  }
  return options;
}

/**
 * Convierte un error de nodemailer en `MailDeliveryError` (correo §4.1). Permanente: el
 * `permanent` de nodemailer (5xx salvo 503) o un sobre mal formado (`EENVELOPE`). `EAUTH` y `ETLS`
 * no lo son: son configuración, y los correos esperan a que se arregle. Nunca copia el mensaje ni
 * la respuesta del servidor.
 */
export function classifySmtpError(error: unknown): MailDeliveryError {
  const fields = (typeof error === 'object' && error !== null ? error : {}) as {
    code?: unknown;
    responseCode?: unknown;
    permanent?: unknown;
  };
  const code =
    typeof fields.responseCode === 'number'
      ? `smtp_${fields.responseCode}`
      : typeof fields.code === 'string' && /^[A-Z_]{1,32}$/.test(fields.code)
        ? fields.code
        : 'unknown';
  const permanent = fields.permanent === true || fields.code === 'EENVELOPE';
  return new MailDeliveryError(permanent, code);
}

/**
 * Campos de nodemailer de un mensaje: `From` = `MAIL_FROM`, texto y HTML (multipart/alternative)
 * y `Auto-Submitted: auto-generated`, que evita las respuestas automáticas (fuera de la oficina…).
 */
export function mailOptions(from: string, message: MailMessage): SendMailOptions {
  return {
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    headers: { 'Auto-Submitted': 'auto-generated' },
  };
}

/** Envío por SMTP con nodemailer. El *transport* se crea una vez, al arrancar. */
export class SmtpMailer extends Mailer {
  private readonly transport: Transporter;

  constructor(
    transportOptions: SMTPTransportOptions,
    private readonly from: string,
  ) {
    super();
    this.transport = nodemailer.createTransport(transportOptions);
  }

  async send(message: MailMessage): Promise<void> {
    try {
      await this.transport.sendMail(mailOptions(this.from, message));
    } catch (error) {
      throw classifySmtpError(error);
    }
  }

  close(): void {
    this.transport.close();
  }
}
