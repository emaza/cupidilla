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
import { ACCOUNT_THROTTLER, THROTTLE_TTL } from '../common/guards/app-throttler.guard.js';
import { UsersService } from './users.service.js';

/**
 * Cubo `account` de la sesión, compartido por borrado, reautenticación y crear contraseña
 * (técnico terceros §12.5): con una sesión robada no se pueden probar más de 5 contraseñas cada
 * 15 minutos sumando todas las rutas.
 */
const SESSION_ACCOUNT_LIMIT = {
  [ACCOUNT_THROTTLER]: {
    limit: 5,
    ttl: THROTTLE_TTL.quarterHour,
    blockDuration: THROTTLE_TTL.quarterHour,
  },
};

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  getAccount(@CurrentSession() session: ActiveSession): Promise<AccountResponse> {
    return this.users.getAccount(session.userId, session);
  }

  @Post('me/reauthentication')
  @HttpCode(204)
  @Throttle(SESSION_ACCOUNT_LIMIT)
  async reauthenticate(
    @CurrentSession() session: ActiveSession,
    @Body({ schema: reauthenticateRequestSchema }) body: ReauthenticateRequest,
  ): Promise<void> {
    await this.users.reauthenticateWithPassword(session, body.password);
  }

  @Post('me/deletion')
  @HttpCode(204)
  @Throttle(SESSION_ACCOUNT_LIMIT)
  async deleteAccount(
    @CurrentSession() session: ActiveSession,
    @Body({ schema: deleteAccountRequestSchema }) body: DeleteAccountRequest,
  ): Promise<void> {
    await this.users.deleteAccount(session.userId, body.password);
  }
}
