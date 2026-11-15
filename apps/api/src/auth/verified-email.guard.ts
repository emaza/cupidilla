import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RequestWithSession } from '../common/decorators/current-session.decorator.js';
import { IS_PUBLIC } from '../common/decorators/public.decorator.js';
import { REQUIRES_VERIFIED_EMAIL } from '../common/decorators/requires-verified-email.decorator.js';
import { ApiException } from '../common/errors/api.exception.js';

/**
 * Guard global, después de `SessionGuard` (correo §5.9): en las rutas con
 * `@RequiresVerifiedEmail()`, una sesión con el correo sin verificar recibe 403
 * `EMAIL_NOT_VERIFIED`. Las rutas `@Public()` y las que no lo declaran pasan sin más.
 */
@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (!this.reflector.getAllAndOverride<boolean>(REQUIRES_VERIFIED_EMAIL, targets)) return true;
    const session = context.switchToHttp().getRequest<RequestWithSession>().session;
    if (session?.user.emailVerified) return true;
    throw new ApiException('EMAIL_NOT_VERIFIED', 403, undefined, 'Email not verified');
  }
}
