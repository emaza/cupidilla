import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AllowDuringDataReview } from '../common/decorators/allow-during-data-review.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { ApiException } from '../common/errors/api.exception.js';
import { DataReviewGuard } from './data-review.guard.js';

class Routes {
  plain(): void {}
  @AllowDuringDataReview()
  allowed(): void {}
  @Public()
  open(): void {}
}

function contextFor(handler: keyof Routes, dataReviewRequired?: boolean): ExecutionContext {
  const session = dataReviewRequired === undefined ? undefined : { user: { dataReviewRequired } };
  return {
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => ({ session }) }),
  } as unknown as ExecutionContext;
}

describe('DataReviewGuard (C3-9)', () => {
  const guard = new DataReviewGuard(new Reflector());

  it('deja pasar una ruta @Public(), una sesión sin revisión pendiente o una ruta con @AllowDuringDataReview()', () => {
    expect(guard.canActivate(contextFor('open'))).toBe(true);
    expect(guard.canActivate(contextFor('open', true))).toBe(true);
    expect(guard.canActivate(contextFor('plain', false))).toBe(true);
    expect(guard.canActivate(contextFor('allowed', true))).toBe(true);
  });

  it('con la revisión pendiente y una ruta sin el decorador → 403 DATA_REVIEW_REQUIRED', () => {
    let thrown: unknown;
    try {
      guard.canActivate(contextFor('plain', true));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApiException);
    expect((thrown as ApiException).code).toBe('DATA_REVIEW_REQUIRED');
    expect((thrown as ApiException).getStatus()).toBe(403);
  });
});
