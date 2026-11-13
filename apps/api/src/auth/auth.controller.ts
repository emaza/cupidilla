import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  loginRequestSchema,
  registerRequestSchema,
  type AuthResponse,
  type LoginRequest,
  type RegisterRequest,
  type SessionResponse,
} from '@cupidilla/contracts';
import {
  CurrentSession,
  type ActiveSession,
} from '../common/decorators/current-session.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import {
  ACCOUNT_THROTTLER,
  IP_THROTTLER,
  THROTTLE_TTL,
} from '../common/guards/app-throttler.guard.js';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Public()
  @HttpCode(201)
  @Throttle({ [IP_THROTTLER]: { limit: 5, ttl: THROTTLE_TTL.hour } })
  register(@Body({ schema: registerRequestSchema }) body: RegisterRequest): Promise<AuthResponse> {
    return this.auth.register(body);
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @Throttle({
    [IP_THROTTLER]: { limit: 10, ttl: THROTTLE_TTL.quarterHour },
    [ACCOUNT_THROTTLER]: {
      limit: 5,
      ttl: THROTTLE_TTL.quarterHour,
      blockDuration: THROTTLE_TTL.quarterHour,
    },
  })
  login(@Body({ schema: loginRequestSchema }) body: LoginRequest): Promise<AuthResponse> {
    return this.auth.login(body);
  }

  @Post('logout')
  @HttpCode(204)
  logout(@CurrentSession() session: ActiveSession): Promise<void> {
    return this.auth.logout(session.tokenHash);
  }

  @Get('session')
  getSession(@CurrentSession() session: ActiveSession): SessionResponse {
    return {
      user: session.user,
      session: { expiresAt: session.expiresAt.toISOString(), renewed: session.renewed },
    };
  }
}
