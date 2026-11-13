import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  oauthSessionStartRequestSchema,
  type OAuthSessionStartRequest,
  type OAuthStartResponse,
} from '@cupidilla/contracts';
import {
  CurrentSession,
  type ActiveSession,
} from '../common/decorators/current-session.decorator.js';
import { SESSION_THROTTLER, THROTTLE_TTL } from '../common/guards/app-throttler.guard.js';
import { IdentitiesService } from './identities.service.js';
import { OAuthFlowService } from './oauth-flow.service.js';
import { parseProvider } from './oauth.controller.js';

/** Formas de entrar desde /account, con sesión (§9.1, §9.3, §9.4). */
@Controller('users/me')
export class OAuthAccountController {
  constructor(
    private readonly flow: OAuthFlowService,
    private readonly identities: IdentitiesService,
  ) {}

  /** Reautenticarse con un proveedor unido, o añadir uno (este exige sesión reciente). */
  @Post('oauth/:provider/authorization')
  @HttpCode(201)
  @Throttle({ [SESSION_THROTTLER]: { limit: 5, ttl: THROTTLE_TTL.quarterHour } })
  start(
    @CurrentSession() session: ActiveSession,
    @Param('provider') provider: string,
    @Body({ schema: oauthSessionStartRequestSchema }) body: OAuthSessionStartRequest,
  ): Promise<OAuthStartResponse> {
    return this.flow.startWithSession(parseProvider(provider), session, body);
  }

  /** Quitar un proveedor; nunca el último método de entrada (§9.4). */
  @Post('identities/:provider/removal')
  @HttpCode(204)
  @Throttle({ [SESSION_THROTTLER]: { limit: 10, ttl: THROTTLE_TTL.quarterHour } })
  async remove(
    @CurrentSession() session: ActiveSession,
    @Param('provider') provider: string,
  ): Promise<void> {
    await this.identities.remove(session.userId, parseProvider(provider));
  }
}
