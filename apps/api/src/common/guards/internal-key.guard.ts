import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { Env } from '../../config/env.schema.js';
import { SKIP_INTERNAL_KEY } from '../decorators/skip-internal-key.decorator.js';
import { ApiException } from '../errors/api.exception.js';

export const INTERNAL_KEY_HEADER = 'x-internal-api-key';

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/** Solo el servidor de SvelteKit, que conoce la clave interna, puede llamar a la API. */
@Injectable()
export class InternalKeyGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService<Env, true>,
  ) {
    this.expected = digest(config.get('INTERNAL_API_KEY', { infer: true }));
  }

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_INTERNAL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const provided = context.switchToHttp().getRequest<Request>().headers[INTERNAL_KEY_HEADER];
    // Se comparan los hashes para que la comparación sea de longitud fija y en tiempo constante.
    if (typeof provided !== 'string' || !timingSafeEqual(digest(provided), this.expected)) {
      throw new ApiException('FORBIDDEN', 403, undefined, 'Missing or invalid internal API key');
    }
    return true;
  }
}
