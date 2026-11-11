import { BadRequestException, NotFoundException, type ArgumentsHost } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { ApiException } from './api.exception.js';
import {
  ApiExceptionFilter,
  describeErrorForLog,
  toErrorResponse,
} from './api-exception.filter.js';

function bodyParserError(type: string, message: string): Error {
  return Object.assign(new SyntaxError(message), { type, status: 400 });
}

describe('toErrorResponse', () => {
  it('deja ApiException tal cual', () => {
    expect(toErrorResponse(new ApiException('EMAIL_TAKEN', 409))).toEqual({
      status: 409,
      body: { error: { code: 'EMAIL_TAKEN' } },
    });
  });

  it('traduce el throttler, el 404 y los errores del body parser', () => {
    expect(toErrorResponse(new ThrottlerException()).body.error.code).toBe('RATE_LIMITED');
    expect(toErrorResponse(new ThrottlerException()).status).toBe(429);
    expect(toErrorResponse(new NotFoundException()).status).toBe(404);
    const parse = bodyParserError('entity.parse.failed', 'Unexpected token');
    expect(toErrorResponse(parse)).toMatchObject({
      status: 400,
      body: { error: { code: 'MALFORMED_REQUEST' } },
    });
    // Así lo entrega el adaptador de Express de Nest 12.
    const wrapped = new BadRequestException('x', { cause: parse });
    expect(toErrorResponse(wrapped).body.error.code).toBe('MALFORMED_REQUEST');
  });

  it('todo lo demás es 500 INTERNAL_ERROR', () => {
    expect(toErrorResponse(new Error('boom'))).toEqual({
      status: 500,
      body: { error: { code: 'INTERNAL_ERROR', message: 'Internal error' } },
    });
    expect(toErrorResponse(new BadRequestException('otra')).status).toBe(500);
  });
});

describe('describeErrorForLog', () => {
  it('de DrizzleQueryError solo registra nombre, código y restricción', () => {
    const cause = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'users_email_unique',
    });
    const error = new DrizzleQueryError(
      'insert into "users" ...',
      ['ana@example.com', '$argon2id$hash', '1990-05-05'],
      cause,
    );
    const described = describeErrorForLog(error);
    expect(described).toEqual({
      name: 'DrizzleQueryError',
      code: '23505',
      constraint: 'users_email_unique',
    });
    const text = JSON.stringify(described);
    for (const secret of ['ana@example.com', '$argon2id$', '1990-05-05']) {
      expect(text).not.toContain(secret);
    }
  });

  it('del body parser solo registra nombre y tipo', () => {
    const error = bodyParserError('entity.parse.failed', '{"password":"secreta"');
    expect(describeErrorForLog(error)).toEqual({
      name: 'SyntaxError',
      type: 'entity.parse.failed',
    });
  });

  it('de los demás errores registra nombre, mensaje y pila', () => {
    const described = describeErrorForLog(new TypeError('fallo propio'));
    expect(described).toMatchObject({ name: 'TypeError', message: 'fallo propio' });
    expect(described.stack).toBeTypeOf('string');
  });
});

describe('ApiExceptionFilter', () => {
  it('responde con la forma única y registra solo los 5xx, saneados', () => {
    const json = vi.fn();
    const response = { headersSent: false, status: vi.fn(() => ({ json })) };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    const filter = new ApiExceptionFilter();
    const logged = vi
      .spyOn((filter as unknown as { logger: { error: () => void } }).logger, 'error')
      .mockImplementation(() => undefined);

    filter.catch(new ApiException('UNDERAGE', 422), host);
    expect(response.status).toHaveBeenLastCalledWith(422);
    expect(json).toHaveBeenLastCalledWith({ error: { code: 'UNDERAGE' } });
    expect(logged).not.toHaveBeenCalled();

    const cause = Object.assign(new Error('x'), { code: '23503', constraint: 'fk' });
    filter.catch(new DrizzleQueryError('q', ['ana@example.com'], cause), host);
    expect(response.status).toHaveBeenLastCalledWith(500);
    expect(logged).toHaveBeenCalledWith({
      name: 'DrizzleQueryError',
      code: '23503',
      constraint: 'fk',
    });
  });
});
