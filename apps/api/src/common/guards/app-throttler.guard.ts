import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerRequest,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import type { Env } from '../../config/env.schema.js';

/** Clave de metadatos con la que `@Throttle` guarda el límite (no se exporta desde el índice del paquete). */
const THROTTLER_LIMIT = 'THROTTLER:LIMIT';

export const CLIENT_IP_HEADER = 'x-client-ip';

/** Conjunto por IP: se aplica a todas las rutas. */
export const IP_THROTTLER = 'ip';
/** Conjunto por cuenta: solo en las rutas que lo declaran con `@Throttle({ account: ... })`. */
export const ACCOUNT_THROTTLER = 'account';

const MINUTE = 60_000;
export const THROTTLE_TTL = { minute: MINUTE, quarterHour: 15 * MINUTE, hour: 60 * MINUTE };

interface TrackedRequest {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

/**
 * IP del cliente. `X-Client-Ip` solo se acepta porque la petición ya pasó la clave
 * interna: la pone el servidor de SvelteKit.
 */
export function ipTracker(req: TrackedRequest): string {
  const header = req.headers?.[CLIENT_IP_HEADER];
  if (typeof header === 'string' && header.trim() !== '') return header.trim();
  return req.ip ?? 'unknown';
}

/** Correo normalizado del cuerpo si viene; si no, el hash del token de sesión. */
export function accountTracker(req: TrackedRequest): string {
  const body = req.body;
  if (body && typeof body === 'object' && 'email' in body && typeof body.email === 'string') {
    return `email:${body.email.trim().toLowerCase()}`;
  }
  const authorization = req.headers?.authorization;
  const token =
    typeof authorization === 'string' && authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
  return `session:${createHash('sha256').update(token).digest('hex')}`;
}

/**
 * Clave del conjunto `account`: solo el tracker, sin la clase ni el método (técnico terceros
 * §12.5). Así el cubo es el mismo en todas las rutas que lo declaran: por correo, `/auth/login`
 * y `/auth/oauth/link`; por sesión, borrado, reautenticación y crear contraseña.
 */
export function accountKey(_context: ExecutionContext, tracker: string, name: string): string {
  return createHash('sha256').update(`${name}-${tracker}`).digest('hex');
}

/**
 * Límite de intentos con dos conjuntos con nombre (§8.8). Multiplica los límites por
 * `RATE_LIMIT_FACTOR`, solo aplica `account` donde la ruta lo declara y responde con
 * `Retry-After`.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  private readonly factor: number;

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    config: ConfigService<Env, true>,
  ) {
    super(options, storageService, reflector);
    this.factor = config.get('RATE_LIMIT_FACTOR', { infer: true });
  }

  protected override async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { context, throttler } = requestProps;
    if (throttler.name === ACCOUNT_THROTTLER && !this.declaresAccountLimit(context)) {
      return true;
    }
    return super.handleRequest({ ...requestProps, limit: requestProps.limit * this.factor });
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const { res } = this.getRequestResponse(context);
    this.setResponseHeader(res, 'Retry-After', Math.max(1, detail.timeToBlockExpire));
    await super.throwThrottlingException(context, detail);
  }

  private declaresAccountLimit(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride(THROTTLER_LIMIT + ACCOUNT_THROTTLER, [
        context.getHandler(),
        context.getClass(),
      ]) !== undefined
    );
  }
}
