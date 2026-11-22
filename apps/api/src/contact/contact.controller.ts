import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { contactRequestSchema, type ContactRequest } from '@cupidilla/contracts';
import { Public } from '../common/decorators/public.decorator.js';
import {
  EMAIL_THROTTLER,
  IP_THROTTLER,
  THROTTLE_TTL,
} from '../common/guards/app-throttler.guard.js';
import { ContactService } from './contact.service.js';

@Controller('contact')
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  /**
   * Formulario de contacto (técnico de contacto §5.2): siempre 202 sin cuerpo, también ante el
   * campo trampa. Pública, con la clave interna como todas las rutas. 3 por hora por IP y 3 al día
   * por correo (multiplicados por `RATE_LIMIT_FACTOR`).
   */
  @Post()
  @Public()
  @HttpCode(202)
  @Throttle({
    [IP_THROTTLER]: { limit: 3, ttl: THROTTLE_TTL.hour },
    [EMAIL_THROTTLER]: { limit: 3, ttl: THROTTLE_TTL.day },
  })
  async submit(@Body({ schema: contactRequestSchema }) body: ContactRequest): Promise<void> {
    await this.contact.submit(body);
  }
}
