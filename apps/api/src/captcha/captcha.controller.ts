import { Controller, Get, Header } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { CaptchaChallenge } from '@cupidilla/contracts';
import { Public } from '../common/decorators/public.decorator.js';
import { ApiException } from '../common/errors/api.exception.js';
import { IP_THROTTLER, THROTTLE_TTL } from '../common/guards/app-throttler.guard.js';
import { CaptchaService } from './captcha.service.js';

@Controller('captcha')
export class CaptchaController {
  constructor(private readonly captcha: CaptchaService) {}

  /**
   * Reto nuevo (técnico de captcha §4.3). Pública, con la clave interna como todas. 30 cada 15
   * minutos por IP (por `RATE_LIMIT_FACTOR`): caben los reintentos de una persona. 404 si la
   * comprobación está desactivada.
   */
  @Get('challenge')
  @Public()
  @Header('Cache-Control', 'no-store')
  @Throttle({ [IP_THROTTLER]: { limit: 30, ttl: THROTTLE_TTL.quarterHour } })
  challenge(): Promise<CaptchaChallenge> {
    if (!this.captcha.enabled) {
      throw new ApiException('NOT_FOUND', 404, undefined, 'Captcha disabled');
    }
    return this.captcha.createChallenge();
  }
}
