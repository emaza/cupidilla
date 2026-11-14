import { Module } from '@nestjs/common';
import { ConsentsModule } from '../consents/consents.module.js';
import { IdentitiesModule } from '../oauth/identities.service.js';
import { PasswordService } from './password.service.js';
import { UnverifiedAccountsSweeper } from './unverified-accounts.sweeper.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [ConsentsModule, IdentitiesModule],
  controllers: [UsersController],
  providers: [UsersService, PasswordService, UnverifiedAccountsSweeper],
  exports: [UsersService, PasswordService],
})
export class UsersModule {}
