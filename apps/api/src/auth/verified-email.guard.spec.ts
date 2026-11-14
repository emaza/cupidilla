import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { Public } from '../common/decorators/public.decorator.js';
import { RequiresVerifiedEmail } from '../common/decorators/requires-verified-email.decorator.js';
import { ApiException } from '../common/errors/api.exception.js';
import { VerifiedEmailGuard } from './verified-email.guard.js';

class Routes {
  plain(): void {}
  @RequiresVerifiedEmail()
  verified(): void {}
  @Public()
  @RequiresVerifiedEmail()
  open(): void {}
}

function contextFor(handler: keyof Routes, emailVerified?: boolean): ExecutionContext {
  const session = emailVerified === undefined ? undefined : { user: { emailVerified } };
  return {
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => ({ session }) }),
  } as unknown as ExecutionContext;
}

describe('VerifiedEmailGuard (B4-5)', () => {
  const guard = new VerifiedEmailGuard(new Reflector());

  it('deja pasar sin el metadato, en una ruta @Public() o con el correo verificado', () => {
    expect(guard.canActivate(contextFor('plain', false))).toBe(true);
    expect(guard.canActivate(contextFor('open'))).toBe(true);
    expect(guard.canActivate(contextFor('verified', true))).toBe(true);
  });

  it('con el metadato y el correo sin verificar → 403 EMAIL_NOT_VERIFIED', () => {
    let thrown: unknown;
    try {
      guard.canActivate(contextFor('verified', false));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApiException);
    expect((thrown as ApiException).code).toBe('EMAIL_NOT_VERIFIED');
    expect((thrown as ApiException).getStatus()).toBe(403);
  });
});
