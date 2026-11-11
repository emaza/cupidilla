import { Module } from '@nestjs/common';
import { ConsentsModule } from '../consents/consents.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionGuard } from './session.guard.js';
import { SessionsService } from './sessions.service.js';

@Module({
  imports: [UsersModule, ConsentsModule],
  controllers: [AuthController],
  providers: [AuthService, SessionsService, SessionGuard],
  exports: [SessionsService, SessionGuard],
})
export class AuthModule {}
