import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  OAUTH_PROVIDERS,
  oauthCallbackRequestSchema,
  oauthCancelPendingRequestSchema,
  oauthSignupRequestSchema,
  oauthStartRequestSchema,
  type OAuthAuthResponse,
  type OAuthCallbackRequest,
  type OAuthCallbackResponse,
  type OAuthCancelPendingRequest,
  type OAuthProvider,
  type OAuthProvidersResponse,
  type OAuthSignupRequest,
  type OAuthStartRequest,
  type OAuthStartResponse,
  type PendingIdentityResponse,
} from '@cupidilla/contracts';
import { Public } from '../common/decorators/public.decorator.js';
import { ApiException } from '../common/errors/api.exception.js';
import { IP_THROTTLER, THROTTLE_TTL } from '../common/guards/app-throttler.guard.js';
import { OAuthFlowService } from './oauth-flow.service.js';
import { PendingIdentitiesService } from './pending-identities.service.js';

export const PENDING_TOKEN_HEADER = 'x-oauth-pending-token';

/** `:provider` desconocido: 404, como un proveedor sin configurar (§10.3). */
export function parseProvider(value: string): OAuthProvider {
  if (!(OAUTH_PROVIDERS as readonly string[]).includes(value)) {
    throw new ApiException('NOT_FOUND', 404, undefined, 'Unknown provider');
  }
  return value as OAuthProvider;
}

/** Empezar y volver escriben filas sin sesión: límite por IP (§12.5). */
const FLOW_LIMIT = { [IP_THROTTLER]: { limit: 20, ttl: THROTTLE_TTL.quarterHour } };

/** Entrada y alta con un proveedor, sin sesión (§10.3). */
@Controller('auth/oauth')
@Public()
export class OAuthController {
  constructor(
    private readonly flow: OAuthFlowService,
    private readonly pending: PendingIdentitiesService,
  ) {}

  @Get('providers')
  providers(): OAuthProvidersResponse {
    return { providers: this.flow.configuredProviders() };
  }

  @Get('pending')
  lookupPending(
    @Headers(PENDING_TOKEN_HEADER) token: string | undefined,
  ): Promise<PendingIdentityResponse> {
    return this.pending.lookup(token);
  }

  @Post('signup')
  @HttpCode(201)
  @Throttle({ [IP_THROTTLER]: { limit: 5, ttl: THROTTLE_TTL.hour } })
  signup(
    @Body({ schema: oauthSignupRequestSchema }) body: OAuthSignupRequest,
  ): Promise<OAuthAuthResponse> {
    return this.pending.signup(body);
  }

  @Post('pending/cancellation')
  @HttpCode(204)
  async cancelPending(
    @Body({ schema: oauthCancelPendingRequestSchema }) body: OAuthCancelPendingRequest,
  ): Promise<void> {
    await this.pending.cancel(body.pendingToken);
  }

  @Post(':provider/authorization')
  @HttpCode(201)
  @Throttle(FLOW_LIMIT)
  start(
    @Param('provider') provider: string,
    @Body({ schema: oauthStartRequestSchema }) body: OAuthStartRequest,
  ): Promise<OAuthStartResponse> {
    return this.flow.start(parseProvider(provider), body);
  }

  @Post(':provider/callback')
  @HttpCode(200)
  @Throttle(FLOW_LIMIT)
  callback(
    @Param('provider') provider: string,
    @Body({ schema: oauthCallbackRequestSchema }) body: OAuthCallbackRequest,
  ): Promise<OAuthCallbackResponse> {
    return this.flow.callback(parseProvider(provider), body);
  }
}
