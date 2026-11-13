import { Module } from '@nestjs/common';
import { ConsentsService } from './consents.service.js';

@Module({ providers: [ConsentsService], exports: [ConsentsService] })
export class ConsentsModule {}
