import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module.js';
import { ContactRetentionSweeper } from './contact-retention.sweeper.js';
import { ContactController } from './contact.controller.js';
import { ContactService } from './contact.service.js';

/**
 * Formulario de contacto (técnico de contacto §2). `MailModule` por `OutboxService`; el resolver
 * lee `contact_messages` con el esquema, sin importar este módulo: no hay ciclo.
 */
@Module({
  imports: [MailModule],
  controllers: [ContactController],
  providers: [ContactService, ContactRetentionSweeper],
})
export class ContactModule {}
