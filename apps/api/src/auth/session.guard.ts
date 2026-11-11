import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RequestWithSession } from '../common/decorators/current-session.decorator.js';
import { IS_PUBLIC } from '../common/decorators/public.decorator.js';
import { ApiException } from '../common/errors/api.exception.js';
import { hashSessionToken, SESSION_TOKEN_PATTERN, SessionsService } from './sessions.service.js';

/** Guard global: todo exige sesión salvo lo marcado con `@Public()`. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithSession>();
    const [scheme, token, ...rest] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token || rest.length > 0 || !SESSION_TOKEN_PATTERN.test(token)) {
      throw new ApiException('UNAUTHENTICATED', 401);
    }
    const session = await this.sessions.validate(hashSessionToken(token));
    if (!session) throw new ApiException('UNAUTHENTICATED', 401);
    request.session = session;
    return true;
  }
}
