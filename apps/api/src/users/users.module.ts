import { Module } from '@nestjs/common';
import { ConsentsModule } from '../consents/consents.module.js';
import { PasswordService } from './password.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [ConsentsModule],
  controllers: [UsersController],
  providers: [UsersService, PasswordService],
  exports: [UsersService, PasswordService],
})
export class UsersModule {}
