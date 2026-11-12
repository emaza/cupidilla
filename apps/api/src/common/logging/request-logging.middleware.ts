import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/** Marcador de `route` cuando ninguna ruta coincidió (404, o error del body parser). */
export const NO_ROUTE = '(sin ruta)';

/**
 * Registra cada petición con `{ method, route, status, ms }` al terminar la respuesta. `route`
 * es el patrón de la ruta, no la URL: así no se cuelan identificadores ni parámetros de
 * consulta (§8.9). Es un middleware, y no un interceptor, para que también queden registradas
 * las respuestas de los guards (401, 403, 429) y de los parsers del cuerpo (400): por eso
 * `configureApp` lo registra antes que nada.
 */
export function requestLoggingMiddleware(): (
  request: Request,
  response: Response,
  next: NextFunction,
) => void {
  const logger = new Logger('HTTP');
  return (request, response, next) => {
    const started = performance.now();
    response.once('finish', () => {
      // Express deja en `request.route` la ruta que coincidió, y ahí sigue al terminar.
      const route: unknown = (request.route as { path?: unknown } | undefined)?.path;
      logger.log({
        method: request.method,
        route: typeof route === 'string' ? route : NO_ROUTE,
        status: response.statusCode,
        ms: Math.round(performance.now() - started),
      });
    });
    next();
  };
}
