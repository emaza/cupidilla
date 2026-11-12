import { ConsoleLogger, StandardSchemaValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ApiExceptionFilter } from './common/errors/api-exception.filter.js';
import { validationExceptionFactory } from './common/errors/validation-exception.factory.js';
import { requestLoggingMiddleware } from './common/logging/request-logging.middleware.js';
import type { Env } from './config/env.schema.js';

/** Configuración común a `main.ts` y a los tests: lo que se prueba es lo que se ejecuta. */
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  app.useLogger(new ConsoleLogger({ json: config.get('LOG_FORMAT', { infer: true }) === 'json' }));
  // Lo primero: así el log de peticiones ve también lo que cortan los parsers y los guards.
  app.use(requestLoggingMiddleware());
  app.useBodyParser('json', { limit: '16kb' });
  app.disable('x-powered-by');
  app.useGlobalPipes(
    new StandardSchemaValidationPipe({ exceptionFactory: validationExceptionFactory }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
