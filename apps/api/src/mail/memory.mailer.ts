import { Injectable } from '@nestjs/common';
import { MailDeliveryError, Mailer, type MailMessage } from './mailer.js';

/**
 * Bandeja en memoria para los tests (correo §4.1, §11.1). Vive en `src/` porque `MailModule` la
 * usa sin `SMTP_URL` con `NODE_ENV=test`; el `envSchema` impide llegar aquí en otro entorno.
 */
@Injectable()
export class MemoryMailer extends Mailer {
  readonly messages: MailMessage[] = [];
  private failures: { permanent: boolean }[] = [];

  send(message: MailMessage): Promise<void> {
    const failure = this.failures.shift();
    if (failure) {
      return Promise.reject(
        new MailDeliveryError(failure.permanent, failure.permanent ? 'smtp_550' : 'smtp_421'),
      );
    }
    this.messages.push(message);
    return Promise.resolve();
  }

  /** Los próximos `count` envíos fallan, de forma transitoria o permanente. */
  failNext(count: number, options: { permanent: boolean }): void {
    for (let i = 0; i < count; i += 1) this.failures.push({ permanent: options.permanent });
  }

  messagesTo(email: string): MailMessage[] {
    return this.messages.filter((message) => message.to === email);
  }

  /**
   * Token del enlace `<origen><path>?token=…` del texto plano del mensaje, o `undefined`.
   * `path`, p. ej. `/verify-email`.
   */
  linkIn(message: MailMessage, path: string): string | undefined {
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`https?://[^\\s/]+${escaped}\\?token=([A-Za-z0-9_-]+)`).exec(
      message.text,
    )?.[1];
  }

  clear(): void {
    this.messages.length = 0;
    this.failures = [];
  }
}
