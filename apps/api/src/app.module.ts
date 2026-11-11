import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { SessionGuard } from './auth/session.guard.js';
import { ClockModule } from './common/clock.js';
import {
  accountTracker,
  ACCOUNT_THROTTLER,
  AppThrottlerGuard,
  IP_THROTTLER,
  ipTracker,
  THROTTLE_TTL,
} from './common/guards/app-throttler.guard.js';
import { InternalKeyGuard } from './common/guards/internal-key.guard.js';
import { RequestLoggingInterceptor } from './common/logging/request-logging.interceptor.js';
import { envSchema } from './config/env.schema.js';
import { ConsentsModule } from './consents/consents.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    // El .env lo carga Node (--env-file) o Vitest, nunca @nestjs/config.
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validationSchema: envSchema }),
    ThrottlerModule.forRoot({
      throttlers: [
        { name: IP_THROTTLER, ttl: THROTTLE_TTL.minute, limit: 120, getTracker: ipTracker },
        // Solo actúa donde la ruta declara su límite (ver AppThrottlerGuard).
        {
          name: ACCOUNT_THROTTLER,
          ttl: THROTTLE_TTL.quarterHour,
          limit: 5,
          getTracker: accountTracker,
        },
      ],
    }),
    ClockModule,
    DatabaseModule,
    ConsentsModule,
    UsersModule,
    AuthModule,
    HealthModule,
  ],
  providers: [
    // Orden de los guards globales: clave interna → límite de intentos → sesión.
    { provide: APP_GUARD, useClass: InternalKeyGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useExisting: SessionGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
  ],
})
export class AppModule {}
