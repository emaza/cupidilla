import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PRIVACY_POLICY_VERSION, type ContactRequest } from '@cupidilla/contracts';
import { Clock } from '../common/clock.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { Env } from '../config/env.schema.js';
import { contactMessages } from '../database/schema/index.js';
import { Transactions } from '../database/transactions.js';
import { OutboxService } from '../mail/outbox.service.js';

/**
 * Mensajes del formulario de contacto (técnico de contacto §5.3). Guarda el mensaje y encola sus
 * correos en la misma transacción; el *worker* los envía. Los logs nunca llevan datos del
 * formulario ni la referencia (R-C8).
 */
@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);
  private readonly toAddress: string;
  private readonly ackEmail: boolean;

  constructor(
    private readonly transactions: Transactions,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
  ) {
    this.toAddress = config.get('CONTACT_TO_ADDRESS', { infer: true });
    this.ackEmail = config.get('CONTACT_ACK_EMAIL', { infer: true });
  }

  async submit(body: ContactRequest): Promise<void> {
    // Campo trampa (A4, A5): la misma respuesta que a una persona, sin guardar ni enviar nada.
    // Va antes que la versión: un bot nunca ve el 409.
    if (body.hp_contact?.trim()) {
      this.logger.log({ event: 'contact_honeypot_triggered' });
      return;
    }
    if (body.privacyPolicyVersion !== PRIVACY_POLICY_VERSION) {
      throw new ApiException(
        'PRIVACY_VERSION_OUTDATED',
        409,
        undefined,
        'Privacy policy version outdated',
      );
    }

    // El acuse se decide al llegar el mensaje: si después cambia la variable, lo pendiente no.
    const ack = this.ackEmail;
    await this.transactions.run(async (tx) => {
      const [row] = await tx
        .insert(contactMessages)
        .values({
          name: body.name,
          email: body.email,
          phone: body.phone ?? null,
          subject: body.subject,
          message: body.message,
          privacyPolicyVersion: body.privacyPolicyVersion,
          createdAt: this.clock.now(),
        })
        .returning({ id: contactMessages.id });
      if (!row) throw new Error('INSERT de contact_messages sin fila');
      await this.outbox.enqueueContact(tx, 'contact_message', this.toAddress, row.id);
      if (ack) await this.outbox.enqueueContact(tx, 'contact_ack', body.email, row.id);
    });
    this.outbox.kick();
    this.logger.log({ event: 'contact_message_received', ack });
  }
}
