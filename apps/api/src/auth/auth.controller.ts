import { Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  emailRequestSchema,
  emailTokenInspectionRequestSchema,
  emailVerificationRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  type AuthResponse,
  type EmailRequest,
  type EmailTokenInspectionRequest,
  type EmailTokenInspectionResponse,
  type EmailVerificationRequest,
  type EmailVerificationResponse,
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
  EMAIL_THROTTLER,
  IP_THROTTLER,
  THROTTLE_TTL,
} from '../common/guards/app-throttler.guard.js';
import { AuthService } from './auth.service.js';
import { EmailVerificationService } from './email-verification.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly verification: EmailVerificationService,
  ) {}

  /** Registro uniforme (correo §5.1): siempre 202 sin cuerpo y sin sesión. */
  @Post('register')
  @Public()
  @HttpCode(202)
  @Throttle({
    [IP_THROTTLER]: { limit: 5, ttl: THROTTLE_TTL.hour },
    [EMAIL_THROTTLER]: { limit: 3, ttl: THROTTLE_TTL.day },
  })
  async register(@Body({ schema: registerRequestSchema }) body: RegisterRequest): Promise<void> {
    await this.auth.register(body);
  }

  /** Pedir (otra vez) el correo de verificación: siempre 202, exista o no la cuenta (§5.3). */
  @Post('email-verification/request')
  @Public()
  @HttpCode(202)
  @Throttle({
    [IP_THROTTLER]: { limit: 5, ttl: THROTTLE_TTL.quarterHour },
    [EMAIL_THROTTLER]: { limit: 5, ttl: THROTTLE_TTL.day },
  })
  async requestVerification(
    @Body({ schema: emailRequestSchema }) body: EmailRequest,
  ): Promise<void> {
    await this.verification.request(body.email);
  }

  /**
   * Comprobar un enlace sin consumirlo (§5.4). Pública, pero lee el `Bearer` si viene. Sin el
   * conjunto `account`: sin correo en el cuerpo, todas las personas sin sesión compartirían cubo.
   */
  @Post('email-tokens/inspection')
  @Public()
  @HttpCode(200)
  @Throttle({ [IP_THROTTLER]: { limit: 30, ttl: THROTTLE_TTL.quarterHour } })
  inspectToken(
    @Body({ schema: emailTokenInspectionRequestSchema }) body: EmailTokenInspectionRequest,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<EmailTokenInspectionResponse> {
    return this.verification.inspect(body, authorization);
  }

  /** Confirmar el correo (§5.4). Pública, pero lee el `Bearer` si viene. */
  @Post('email-verification')
  @Public()
  @HttpCode(200)
  @Throttle({ [IP_THROTTLER]: { limit: 20, ttl: THROTTLE_TTL.quarterHour } })
  confirmEmail(
    @Body({ schema: emailVerificationRequestSchema }) body: EmailVerificationRequest,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<EmailVerificationResponse> {
    return this.verification.confirm(body, authorization);
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
