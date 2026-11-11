import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';

/**
 * Registra cada petición con `{ method, route, status, ms }`. `route` es el patrón de la
 * ruta, no la URL: así no se cuelan identificadores ni parámetros de consulta (§8.9).
 */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const started = performance.now();
    response.once('finish', () => {
      const route: unknown = (request.route as { path?: unknown } | undefined)?.path;
      this.logger.log({
        method: request.method,
        route: typeof route === 'string' ? route : null,
        status: response.statusCode,
        ms: Math.round(performance.now() - started),
      });
    });
    return next.handle();
  }
}
