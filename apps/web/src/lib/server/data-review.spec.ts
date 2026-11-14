import { describe, expect, it } from 'vitest';
import { mustReviewData } from './data-review.ts';

const pending = { dataReviewRequired: true };

describe('mustReviewData: redirección de guardRoutes con la revisión pendiente (C4-3)', () => {
  it.each(['/(private)/account', '/(private)/account/password', '/', '/(guest)/login', null])(
    '%s → a /account/review',
    (routeId) => {
      expect(mustReviewData(pending, routeId)).toBe(true);
    },
  );

  it.each([
    '/(private)/account/review',
    '/(private)/account/delete',
    '/legal/terms',
    '/verify-email',
    '/forgot-password',
    '/forgot-password/check-email',
    '/reset-password',
  ])('%s se pinta', (routeId) => {
    expect(mustReviewData(pending, routeId)).toBe(false);
  });

  it('sin sesión o sin revisión pendiente, nada', () => {
    expect(mustReviewData(null, '/(private)/account')).toBe(false);
    expect(mustReviewData({ dataReviewRequired: false }, '/(private)/account')).toBe(false);
  });
});
