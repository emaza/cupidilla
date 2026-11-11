import { registerRequestSchema } from '@cupidilla/contracts';
import { describe, expect, it } from 'vitest';
import { validationExceptionFactory } from './validation-exception.factory.js';

describe('validationExceptionFactory', () => {
  it('construye un 400 VALIDATION_FAILED con path e issue', () => {
    const exception = validationExceptionFactory([
      { message: 'too_short', path: ['password'] },
      { message: 'invalid_format', path: [{ key: 'user' }, 'birthDate'] },
      { message: 'Mensaje libre de otra librería', path: [] },
    ]);
    expect(exception.getStatus()).toBe(400);
    expect(exception.toBody()).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        fields: [
          { path: 'password', issue: 'too_short' },
          { path: 'user.birthDate', issue: 'invalid_format' },
          { path: '', issue: 'invalid' },
        ],
      },
    });
  });

  it('recibe intactos los códigos de los esquemas de contracts por Standard Schema', async () => {
    const result = await registerRequestSchema['~standard'].validate({
      email: 'no-es-correo',
      password: 'corta',
      birthDate: '2007-02-29',
      acceptTerms: true,
      termsVersion: 'v',
    });
    if (!result.issues) throw new Error('debería fallar');
    expect(validationExceptionFactory(result.issues).fields).toEqual([
      { path: 'email', issue: 'invalid_format' },
      { path: 'password', issue: 'too_short' },
      { path: 'birthDate', issue: 'invalid_format' },
    ]);
  });
});
