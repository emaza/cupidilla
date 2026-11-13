import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { ApiErrorBody } from '@cupidilla/contracts';
import { DrizzleQueryError } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { isConnectionLost } from '../../database/pg-errors.js';
import { ApiException } from './api.exception.js';

const BODY_PARSER_ERROR_TYPES = new Set([
  'entity.parse.failed',
  'entity.too.large',
  'entity.verify.failed',
  'encoding.unsupported',
  'charset.unsupported',
  'request.aborted',
  'request.size.invalid',
  'stream.encoding.set',
  'stream.not.readable',
]);

interface BodyParserError extends Error {
  type: string;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  return (
    error instanceof Error &&
    typeof (error as Partial<BodyParserError>).type === 'string' &&
    BODY_PARSER_ERROR_TYPES.has((error as BodyParserError).type)
  );
}

/**
 * Error 4xx de `http-errors` (body parser, Express). Algunos no llevan `type`: por ejemplo, el
 * de un cuerpo comprimido que no se puede descomprimir es el error de zlib con `statusCode` 400.
 */
function isClientHttpError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' && status >= 400 && status < 500;
}

/**
 * El adaptador de Express envuelve los errores del body parser (y los `URIError` de una ruta
 * mal codificada) en una `HttpException` con el original en `cause`.
 */
function isMalformedRequest(error: unknown): boolean {
  if (isBodyParserError(error)) return true;
  if (!(error instanceof HttpException)) return false;
  const cause = error.cause;
  return (
    isBodyParserError(cause) ||
    isClientHttpError(cause) ||
    cause instanceof SyntaxError ||
    cause instanceof URIError
  );
}

/**
 * Traduce cualquier excepción a la forma única de error de §6.3. `method` es el de la petición:
 * si no es GET y se perdió la conexión con PostgreSQL con la consulta en marcha, la escritura
 * pudo hacerse o no, y se responde 503 `OUTCOME_UNKNOWN` en lugar de 500.
 */
export function toErrorResponse(
  exception: unknown,
  method = 'GET',
): { status: number; body: ApiErrorBody } {
  if (exception instanceof ApiException) {
    return { status: exception.getStatus(), body: exception.toBody() };
  }
  if (exception instanceof ThrottlerException) {
    return { status: 429, body: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } } };
  }
  if (exception instanceof NotFoundException) {
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  }
  if (isMalformedRequest(exception)) {
    return {
      status: 400,
      body: { error: { code: 'MALFORMED_REQUEST', message: 'Malformed request body' } },
    };
  }
  if (method !== 'GET' && method !== 'HEAD' && isConnectionLost(exception)) {
    return {
      status: 503,
      body: { error: { code: 'OUTCOME_UNKNOWN', message: 'Outcome unknown' } },
    };
  }
  return { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'Internal error' } } };
}

/**
 * Describe un error para el log sin datos personales (§8.9). El `message` de
 * `DrizzleQueryError` lleva los parámetros de la consulta y el de los errores del
 * body parser puede llevar un trozo del cuerpo: de ellos solo se registran campos seguros.
 */
export function describeErrorForLog(error: unknown): Record<string, unknown> {
  if (error instanceof DrizzleQueryError) {
    const cause = error.cause as { code?: unknown; constraint?: unknown } | undefined;
    return { name: 'DrizzleQueryError', code: cause?.code, constraint: cause?.constraint };
  }
  if (isBodyParserError(error)) {
    return { name: error.name, type: error.type };
  }
  if (error instanceof HttpException && isBodyParserError(error.cause)) {
    return { name: error.name, type: error.cause.type };
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { name: typeof error };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const { status, body } = toErrorResponse(exception, http.getRequest<Request>().method);
    if (status >= 500) {
      this.logger.error(describeErrorForLog(exception));
    }
    if (response.headersSent) return;
    response.status(status).json(body);
  }
}
