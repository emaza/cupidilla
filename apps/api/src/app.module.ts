import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { SessionGuard } from './auth/session.guard.js';
import { VerifiedEmailGuard } from './auth/verified-email.guard.js';
import { ClockModule } from './common/clock.js';
import {
  accountKey,
  accountTracker,
  ACCOUNT_THROTTLER,
  AppThrottlerGuard,
  EMAIL_THROTTLER,
  emailTracker,
  IP_THROTTLER,
  ipTracker,
  SESSION_THROTTLER,
  THROTTLE_TTL,
} from './common/guards/app-throttler.guard.js';
import { InternalKeyGuard } from './common/guards/internal-key.guard.js';
import { AppConfigModule } from './config/app-config.module.js';
import { envSchema } from './config/env.schema.js';
import { ConsentsModule } from './consents/consents.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { MailModule } from './mail/mail.module.js';
import { OAuthModule } from './oauth/oauth.module.js';
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
          // Un cubo por correo o por sesión, compartido entre rutas (técnico terceros §12.5).
          generateKey: accountKey,
        },
        // Por sesión, un cubo por ruta. Solo donde la ruta lo declara.
        {
          name: SESSION_THROTTLER,
          ttl: THROTTLE_TTL.quarterHour,
          limit: 10,
          getTracker: accountTracker,
        },
        // Por correo del cuerpo, un cubo por ruta (correo §7.3). Solo donde la ruta lo declara.
        {
          name: EMAIL_THROTTLER,
          ttl: THROTTLE_TTL.day,
          limit: 5,
          getTracker: emailTracker,
        },
      ],
    }),
    ClockModule,
    DatabaseModule,
    ConsentsModule,
    UsersModule,
    MailModule,
    AuthModule,
    OAuthModule,
    HealthModule,
    AppConfigModule,
  ],
  providers: [
    // Orden de los guards globales: clave interna → límite de intentos → sesión → correo verificado.
    { provide: APP_GUARD, useClass: InternalKeyGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useExisting: SessionGuard },
    { provide: APP_GUARD, useClass: VerifiedEmailGuard },
  ],
})
export class AppModule {}
