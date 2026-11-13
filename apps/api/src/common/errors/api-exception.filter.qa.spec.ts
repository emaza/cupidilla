import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { toErrorResponse } from './api-exception.filter.js';

// Segunda revisión de QA: el filtro ahora convierte en 400 cualquier error 4xx del body parser.
// Estos tests comprueban que la regla no se ha ensanchado de más: lo que de verdad es un fallo
// interno sigue siendo un 500.

/** Como el error de zlib/http-errors que sube de un cuerpo comprimido que no se descomprime. */
function httpError(statusCode: number): Error {
  return Object.assign(new Error('incorrect header check'), { statusCode, status: statusCode });
}

describe('QA: toErrorResponse y los errores con statusCode', () => {
  it('un 4xx de http-errors envuelto por Nest es 400 MALFORMED_REQUEST', () => {
    for (const status of [400, 413, 415, 422]) {
      const wrapped = new BadRequestException('x', { cause: httpError(status) });
      expect(toErrorResponse(wrapped), `statusCode ${status}`).toEqual({
        status: 400,
        body: { error: { code: 'MALFORMED_REQUEST', message: 'Malformed request body' } },
      });
    }
  });

  it('un statusCode de 5xx, sin número o que no es un número sigue siendo 500', () => {
    for (const statusCode of [500, 503, undefined, '400', 399, 600, null]) {
      const cause = Object.assign(new Error('fallo'), { statusCode });
      const wrapped = new BadRequestException('x', { cause });
      expect(toErrorResponse(wrapped).status, `statusCode ${String(statusCode)}`).toBe(500);
    }
  });

  it('un error cualquiera, aunque lleve statusCode 4xx, si no viene envuelto en HttpException es 500', () => {
    expect(toErrorResponse(httpError(400)).status).toBe(500);
    expect(toErrorResponse(Object.assign(new TypeError('x'), { statusCode: 400 })).status).toBe(
      500,
    );
  });

  it('una excepción de Nest con causa de programación (TypeError, RangeError) es 500', () => {
    for (const cause of [new TypeError('x'), new RangeError('x'), new Error('x'), 'texto', 42]) {
      expect(toErrorResponse(new InternalServerErrorException('x', { cause })).status).toBe(500);
    }
  });

  it('el cuerpo de un 500 no lleva ni el mensaje ni la pila del error', () => {
    const body = toErrorResponse(new Error('correo ana@example.com y clave secreta')).body;
    expect(JSON.stringify(body)).not.toContain('ana@example.com');
    expect(JSON.stringify(body)).not.toContain('secreta');
  });
});
