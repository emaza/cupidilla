import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConfigResponse } from '@cupidilla/contracts';
import { Public } from '../common/decorators/public.decorator.js';
import type { Env } from './env.schema.js';

/** Ajustes públicos de la instalación. Sin sesión, pero con la clave interna como todas las rutas. */
@Controller('config')
export class ConfigController {
  constructor(private readonly config: ConfigService<Env, true>) {}

  @Get()
  @Public()
  get(): ConfigResponse {
    return {
      minAge: this.config.get('MIN_AGE', { infer: true }),
      // Correos opcionales (correo §5.8): la web decide con ellos qué textos pinta.
      mail: {
        unverifiedReminder: this.config.get('EMAIL_UNVERIFIED_REMINDER', { infer: true }),
        passwordChangedNotice: this.config.get('EMAIL_PASSWORD_CHANGED_NOTICE', { infer: true }),
      },
    };
  }
}
