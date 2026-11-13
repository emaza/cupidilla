import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  deleteAccountRequestSchema,
  type AccountResponse,
  type DeleteAccountRequest,
} from '@cupidilla/contracts';
import {
  CurrentSession,
  type ActiveSession,
} from '../common/decorators/current-session.decorator.js';
import { ACCOUNT_THROTTLER, THROTTLE_TTL } from '../common/guards/app-throttler.guard.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  getAccount(@CurrentSession() session: ActiveSession): Promise<AccountResponse> {
    return this.users.getAccount(session.userId);
  }

  @Post('me/deletion')
  @HttpCode(204)
  @Throttle({ [ACCOUNT_THROTTLER]: { limit: 5, ttl: THROTTLE_TTL.quarterHour } })
  async deleteAccount(
    @CurrentSession() session: ActiveSession,
    @Body({ schema: deleteAccountRequestSchema }) body: DeleteAccountRequest,
  ): Promise<void> {
    await this.users.deleteAccount(session.userId, body.password);
  }
}
