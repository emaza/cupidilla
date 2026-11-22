import { type CanActivate, type ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CAPTCHA_HEADER } from '@cupidilla/contracts';
import type { Request } from 'express';
import { REQUIRES_CAPTCHA } from '../common/decorators/requires-captcha.decorator.js';
import { ApiException } from '../common/errors/api.exception.js';
import { CaptchaService } from './captcha.service.js';

/**
 * Comprobación antibots (técnico de captcha §4.7). Global, pero solo actúa en las rutas con
 * `@RequiresCaptcha()` y con `CAPTCHA_ENABLED=true`. Va después de la clave interna y antes del
 * límite de intentos: un envío sin comprobación no gasta el cupo de nadie. No lee el cuerpo.
 */
@Injectable()
export class CaptchaGuard implements CanActivate {
  private readonly logger = new Logger(CaptchaGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly captcha: CaptchaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRES_CAPTCHA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || !this.captcha.enabled) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers[CAPTCHA_HEADER];
    const verdict =
      typeof header === 'string' || header === undefined
        ? await this.captcha.verify(header)
        : ({ ok: false, reason: 'malformed' } as const);
    if (verdict.ok) return true;

    // El patrón de la ruta, nunca la cabecera, el reto ni la IP (§9).
    const route: unknown = (request.route as { path?: unknown } | undefined)?.path;
    this.logger.log({
      event: 'captcha_rejected',
      reason: verdict.reason,
      route: typeof route === 'string' ? route : undefined,
    });
    throw new ApiException(
      verdict.reason === 'missing' ? 'CAPTCHA_REQUIRED' : 'CAPTCHA_INVALID',
      400,
      undefined,
      verdict.reason === 'missing' ? 'Captcha required' : 'Captcha invalid',
    );
  }
}
