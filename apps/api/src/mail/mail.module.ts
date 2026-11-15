import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';
import { IdentitiesModule } from '../oauth/identities.service.js';
import { EmailTokensService } from './email-tokens.service.js';
import { MailResolver } from './mail-resolver.js';
import { Mailer } from './mailer.js';
import { MemoryMailer } from './memory.mailer.js';
import { OutboxService } from './outbox.service.js';
import { OutboxWorker } from './outbox.worker.js';
import { SmtpMailer, smtpTransportOptions } from './smtp.mailer.js';

/**
 * Con `SMTP_URL`, siempre `SmtpMailer`. Sin ella solo se llega aquí con `NODE_ENV=test` (lo
 * impide el `envSchema`): `MemoryMailer`. Se comprueba otra vez por si acaso.
 */
export function createMailer(config: ConfigService<Env, true>): Mailer {
  const smtpUrl = config.get('SMTP_URL', { infer: true });
  if (smtpUrl) {
    return new SmtpMailer(smtpTransportOptions(smtpUrl), config.get('MAIL_FROM', { infer: true }));
  }
  if (config.get('NODE_ENV', { infer: true }) !== 'test') {
    throw new Error('SMTP_URL es obligatoria (salvo con NODE_ENV=test).');
  }
  return new MemoryMailer();
}

/**
 * Envío de correo (correo §4): el puerto `Mailer`, el *outbox* con su *worker* y los tokens de
 * los enlaces. `IdentitiesModule` para resolver el destinatario del aviso de registro (R7b).
 */
@Module({
  imports: [IdentitiesModule],
  providers: [
    { provide: Mailer, inject: [ConfigService], useFactory: createMailer },
    EmailTokensService,
    MailResolver,
    OutboxWorker,
    OutboxService,
  ],
  exports: [OutboxService, EmailTokensService],
})
export class MailModule implements OnApplicationShutdown {
  constructor(private readonly mailer: Mailer) {}

  onApplicationShutdown(): void {
    if (this.mailer instanceof SmtpMailer) this.mailer.close();
  }
}
