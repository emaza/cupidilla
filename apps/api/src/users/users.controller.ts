import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  deleteAccountRequestSchema,
  reauthenticateRequestSchema,
  type AccountResponse,
  type DeleteAccountRequest,
  type ReauthenticateRequest,
} from '@cupidilla/contracts';
import { AllowDuringDataReview } from '../common/decorators/allow-during-data-review.decorator.js';
import {
  CurrentSession,
  type ActiveSession,
} from '../common/decorators/current-session.decorator.js';
import {
  SESSION_PASSWORD_LIMIT,
  SESSION_THROTTLER,
  THROTTLE_TTL,
} from '../common/guards/app-throttler.guard.js';
import { DataReviewService } from './data-review.service.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly dataReview: DataReviewService,
  ) {}

  @Get('me')
  @AllowDuringDataReview()
  getAccount(@CurrentSession() session: ActiveSession): Promise<AccountResponse> {
    return this.users.getAccount(session);
  }

  @Post('me/reauthentication')
  @HttpCode(204)
  @Throttle(SESSION_PASSWORD_LIMIT)
  async reauthenticate(
    @CurrentSession() session: ActiveSession,
    @Body({ schema: reauthenticateRequestSchema }) body: ReauthenticateRequest,
  ): Promise<void> {
    await this.users.reauthenticateWithPassword(session, body.password);
  }

  /** Revisión de datos tras recuperar una cuenta sin verificar (correo §5.11). */
  @Post('me/data-review')
  @AllowDuringDataReview()
  @HttpCode(204)
  @Throttle({ [SESSION_THROTTLER]: { limit: 10, ttl: THROTTLE_TTL.quarterHour } })
  async completeDataReview(
    @CurrentSession() session: ActiveSession,
    @Body() body: unknown,
  ): Promise<void> {
    // Sin esquema: la edad se comprueba antes que la forma del resto (correo §5.11).
    await this.dataReview.complete(session.userId, body);
  }

  /** Quien no quiera la cuenta puede borrarla sin terminar la revisión (§5.11). */
  @Post('me/deletion')
  @AllowDuringDataReview()
  @HttpCode(204)
  @Throttle(SESSION_PASSWORD_LIMIT)
  async deleteAccount(
    @CurrentSession() session: ActiveSession,
    @Body({ schema: deleteAccountRequestSchema }) body: DeleteAccountRequest,
  ): Promise<void> {
    await this.users.deleteAccount(session, body.password);
  }
}
