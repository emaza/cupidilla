import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module.js';
import type { Env } from '../config/env.schema.js';
import { ConsentsModule } from '../consents/consents.module.js';
import { UsersModule } from '../users/users.module.js';
import { IdentitiesModule } from './identities.service.js';
import { OAuthFlowService } from './oauth-flow.service.js';
import { OAuthAccountController } from './oauth-account.controller.js';
import { OAuthController } from './oauth.controller.js';
import { PendingIdentitiesService } from './pending-identities.service.js';
import { createProviderClients, PROVIDER_CLIENTS } from './providers/provider-clients.js';

@Module({
  imports: [UsersModule, ConsentsModule, AuthModule, IdentitiesModule],
  controllers: [OAuthController, OAuthAccountController],
  providers: [
    {
      provide: PROVIDER_CLIENTS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createProviderClients({
          PUBLIC_WEB_URL: config.get('PUBLIC_WEB_URL', { infer: true }),
          GOOGLE_CLIENT_ID: config.get('GOOGLE_CLIENT_ID', { infer: true }),
          GOOGLE_CLIENT_SECRET: config.get('GOOGLE_CLIENT_SECRET', { infer: true }),
          FACEBOOK_APP_ID: config.get('FACEBOOK_APP_ID', { infer: true }),
          FACEBOOK_APP_SECRET: config.get('FACEBOOK_APP_SECRET', { infer: true }),
          OAUTH_HTTP_TIMEOUT_MS: config.get('OAUTH_HTTP_TIMEOUT_MS', { infer: true }),
          OAUTH_FAKE_PROVIDER_URL: config.get('OAUTH_FAKE_PROVIDER_URL', { infer: true }),
        }),
    },
    OAuthFlowService,
    PendingIdentitiesService,
  ],
})
export class OAuthModule {}
