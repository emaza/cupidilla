import { describe, expect, it } from 'vitest';
import { passwordResetSchema, publicUserSchema } from './auth.js';
import { SERVICE_TERMS_VERSION } from './consents.js';
import { ERROR_CODES } from './errors.js';
import { dataReviewRequestSchema } from './users.js';

const TOKEN = 'a'.repeat(42) + '_';

function issues(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) {
  return result.success
    ? []
    : (result.error?.issues ?? []).map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

describe('passwordResetSchema (C1-1)', () => {
  it('con 9 caracteres da too_short; con 10 se acepta', () => {
    expect(
      issues(passwordResetSchema.safeParse({ token: TOKEN, password: 'a'.repeat(9) })),
    ).toEqual(['password: too_short']);
    expect(passwordResetSchema.safeParse({ token: TOKEN, password: 'a'.repeat(10) }).success).toBe(
      true,
    );
  });

  it('exige un token con forma válida y no admite campos desconocidos', () => {
    expect(passwordResetSchema.safeParse({ token: 'abc', password: 'a'.repeat(10) }).success).toBe(
      false,
    );
    expect(
      issues(passwordResetSchema.safeParse({ token: TOKEN, password: 'a'.repeat(10), x: 1 })),
    ).toEqual([': unrecognized']);
  });
});

describe('dataReviewRequestSchema (C1-2)', () => {
  const valid = { birthDate: '1990-05-05', acceptTerms: true, termsVersion: SERVICE_TERMS_VERSION };

  it('acepta una revisión completa', () => {
    expect(dataReviewRequestSchema.parse(valid)).toEqual(valid);
  });

  it('acceptTerms falso da acceptTerms: required', () => {
    expect(issues(dataReviewRequestSchema.safeParse({ ...valid, acceptTerms: false }))).toEqual([
      'acceptTerms: required',
    ]);
  });

  it('un campo desconocido da unrecognized', () => {
    expect(issues(dataReviewRequestSchema.safeParse({ ...valid, email: 'x@example.com' }))).toEqual(
      [': unrecognized'],
    );
  });
});

describe('códigos y campos de la fase C (C1-3)', () => {
  it('ERROR_CODES contiene DATA_REVIEW_REQUIRED', () => {
    expect(ERROR_CODES).toContain('DATA_REVIEW_REQUIRED');
  });

  it('publicUserSchema exige dataReviewRequired', () => {
    const user = {
      id: '6f1d2c3b-4a5e-4f60-8b7c-9d0e1f2a3b4c',
      email: 'beto@example.com',
      createdAt: '2026-11-11T10:00:00.000Z',
      emailVerified: true,
    };
    expect(publicUserSchema.safeParse(user).success).toBe(false);
    expect(publicUserSchema.safeParse({ ...user, dataReviewRequired: true }).success).toBe(true);
  });
});
