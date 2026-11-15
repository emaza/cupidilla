import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_DURING_DATA_REVIEW } from '../common/decorators/allow-during-data-review.decorator.js';
import type { RequestWithSession } from '../common/decorators/current-session.decorator.js';
import { IS_PUBLIC } from '../common/decorators/public.decorator.js';
import { ApiException } from '../common/errors/api.exception.js';

/**
 * Guard global, el último (correo §5.11): una sesión cuya cuenta tiene la revisión de datos
 * pendiente solo puede usar las rutas con `@AllowDuringDataReview()`; el resto responde 403
 * `DATA_REVIEW_REQUIRED`. Lista blanca: las rutas nuevas quedan bloqueadas sin hacer nada. Las
 * rutas `@Public()` no se ven afectadas.
 */
@Injectable()
export class DataReviewGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const session = context.switchToHttp().getRequest<RequestWithSession>().session;
    if (!session?.user.dataReviewRequired) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_DURING_DATA_REVIEW, targets)) return true;
    throw new ApiException('DATA_REVIEW_REQUIRED', 403, undefined, 'Data review required');
  }
}
