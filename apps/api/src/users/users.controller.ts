import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  deleteAccountRequestSchema,
  reauthenticateRequestSchema,
  type AccountResponse,
  type DeleteAccountRequest,
  type ReauthenticateRequest,
} from '@cupidilla/contracts';
import {
  CurrentSession,
  type ActiveSession,
} from '../common/decorators/current-session.decorator.js';
import { SESSION_PASSWORD_LIMIT } from '../common/guards/app-throttler.guard.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
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

  @Post('me/deletion')
  @HttpCode(204)
  @Throttle(SESSION_PASSWORD_LIMIT)
  async deleteAccount(
    @CurrentSession() session: ActiveSession,
    @Body({ schema: deleteAccountRequestSchema }) body: DeleteAccountRequest,
  ): Promise<void> {
    await this.users.deleteAccount(session, body.password);
  }
}
