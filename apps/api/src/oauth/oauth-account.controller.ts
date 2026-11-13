import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  oauthSessionStartRequestSchema,
  removeIdentityRequestSchema,
  type OAuthSessionStartRequest,
  type OAuthStartResponse,
  type RemoveIdentityRequest,
} from '@cupidilla/contracts';
import {
  CurrentSession,
  type ActiveSession,
} from '../common/decorators/current-session.decorator.js';
import {
  SESSION_PASSWORD_LIMIT,
  SESSION_THROTTLER,
  THROTTLE_TTL,
} from '../common/guards/app-throttler.guard.js';
import { UsersService } from '../users/users.service.js';
import { IdentitiesService } from './identities.service.js';
import { OAuthFlowService } from './oauth-flow.service.js';
import { parseProvider } from './oauth.controller.js';

/** Formas de entrar desde /account, con sesión (§9.1, §9.3, §9.4). */
@Controller('users/me')
export class OAuthAccountController {
  constructor(
    private readonly flow: OAuthFlowService,
    private readonly identities: IdentitiesService,
    private readonly users: UsersService,
  ) {}

  /** Reautenticarse con un proveedor unido, o añadir uno (este exige sesión reciente). */
  @Post('oauth/:provider/authorization')
  @HttpCode(201)
  @Throttle({
    [SESSION_THROTTLER]: { limit: 5, ttl: THROTTLE_TTL.quarterHour },
    ...SESSION_PASSWORD_LIMIT,
  })
  start(
    @CurrentSession() session: ActiveSession,
    @Param('provider') provider: string,
    @Body({ schema: oauthSessionStartRequestSchema }) body: OAuthSessionStartRequest,
  ): Promise<OAuthStartResponse> {
    return this.flow.startWithSession(parseProvider(provider), session, body);
  }

  /**
   * Quitar un proveedor; nunca el último método de entrada (§9.4). Una cuenta con contraseña la
   * escribe para confirmar; una sin contraseña no necesita nada más (decisión 20).
   */
  @Post('identities/:provider/removal')
  @HttpCode(204)
  @Throttle({
    [SESSION_THROTTLER]: { limit: 10, ttl: THROTTLE_TTL.quarterHour },
    ...SESSION_PASSWORD_LIMIT,
  })
  async remove(
    @CurrentSession() session: ActiveSession,
    @Param('provider') provider: string,
    // Sin cuerpo (cuenta sin contraseña) cuenta como `{}`.
    @Body({ schema: z.preprocess((value) => value ?? {}, removeIdentityRequestSchema) })
    body: RemoveIdentityRequest,
  ): Promise<void> {
    const known = parseProvider(provider);
    await this.users.confirmPassword(session.userId, body.password);
    await this.identities.remove(session.userId, known);
  }
}
