import { Module } from '@nestjs/common';
import { ConsentsModule } from '../consents/consents.module.js';
import { MailModule } from '../mail/mail.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { EmailVerificationService } from './email-verification.service.js';
import { PasswordResetService } from './password-reset.service.js';
import { SessionGuard } from './session.guard.js';
import { SessionsService } from './sessions.service.js';

@Module({
  imports: [UsersModule, ConsentsModule, MailModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    EmailVerificationService,
    PasswordResetService,
    SessionsService,
    SessionGuard,
  ],
  exports: [SessionsService, SessionGuard],
})
export class AuthModule {}
