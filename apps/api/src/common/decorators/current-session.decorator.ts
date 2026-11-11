import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { PublicUser } from '@cupidilla/contracts';
import type { Request } from 'express';

/** Sesión validada por `SessionGuard`. */
export interface ActiveSession {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  renewed: boolean;
  user: PublicUser;
}

export type RequestWithSession = Request & { session?: ActiveSession };

export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ActiveSession => {
    const session = context.switchToHttp().getRequest<RequestWithSession>().session;
    if (!session) {
      throw new Error('CurrentSession usado en una ruta sin SessionGuard');
    }
    return session;
  },
);
