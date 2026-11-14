import { describe, expect, it } from 'vitest';
import {
  emailRequestSchema,
  emailTokenInspectionRequestSchema,
  emailVerificationRequestSchema,
  emailVerificationResponseSchema,
  opaqueTokenSchema,
  publicUserSchema,
} from './auth.js';
import { ERROR_CODES } from './errors.js';
import { pendingIdentityResponseSchema } from './oauth.js';
import { accountResponseSchema } from './users.js';

const TOKEN = 'a'.repeat(42) + '_';
const auth = {
  user: {
    id: '6f1d2c3b-4a5e-4f60-8b7c-9d0e1f2a3b4c',
    email: 'beto@example.com',
    createdAt: '2026-11-11T10:00:00.000Z',
    emailVerified: true,
  },
  session: { token: TOKEN, expiresAt: '2026-12-11T10:00:00.000Z' },
};

describe('emailVerificationResponseSchema (B1-1)', () => {
  it('acepta same, kept-other y opened con un auth válido', () => {
    expect(emailVerificationResponseSchema.parse({ session: 'same' })).toEqual({ session: 'same' });
    expect(emailVerificationResponseSchema.parse({ session: 'kept-other' })).toEqual({
      session: 'kept-other',
    });
    expect(emailVerificationResponseSchema.parse({ session: 'opened', auth })).toEqual({
      session: 'opened',
      auth,
    });
  });

  it('rechaza otro valor, y opened sin auth', () => {
    expect(emailVerificationResponseSchema.safeParse({ session: 'otra' }).success).toBe(false);
    expect(emailVerificationResponseSchema.safeParse({ session: 'opened' }).success).toBe(false);
  });
});

describe('opaqueTokenSchema (B1-2)', () => {
  it('solo acepta 43 caracteres base64url', () => {
    expect(opaqueTokenSchema.safeParse('a'.repeat(42)).success).toBe(false);
    expect(opaqueTokenSchema.safeParse('a'.repeat(44)).success).toBe(false);
    expect(opaqueTokenSchema.safeParse('a'.repeat(42) + '+').success).toBe(false);
    expect(opaqueTokenSchema.safeParse('Az09-_'.repeat(7) + 'x').success).toBe(true);
  });

  it('las peticiones con token lo validan igual', () => {
    expect(
      emailTokenInspectionRequestSchema.safeParse({ token: TOKEN, purpose: 'verify_email' })
        .success,
    ).toBe(true);
    expect(
      emailTokenInspectionRequestSchema.safeParse({ token: 'abc', purpose: 'verify_email' })
        .success,
    ).toBe(false);
    expect(
      emailTokenInspectionRequestSchema.safeParse({ token: TOKEN, purpose: 'otra' }).success,
    ).toBe(false);
    expect(emailVerificationRequestSchema.safeParse({ token: TOKEN }).success).toBe(true);
    expect(emailVerificationRequestSchema.safeParse({ token: TOKEN, password: 'x' }).success).toBe(
      true,
    );
    expect(emailVerificationRequestSchema.safeParse({ token: TOKEN, extra: 1 }).success).toBe(
      false,
    );
  });
});

describe('emailRequestSchema (B1-3)', () => {
  it('normaliza el correo', () => {
    expect(emailRequestSchema.parse({ email: ' Ana@Example.COM ' })).toEqual({
      email: 'ana@example.com',
    });
    expect(emailRequestSchema.safeParse({ email: 'ana@example.com', extra: 1 }).success).toBe(
      false,
    );
  });
});

describe('códigos y campos nuevos (B1-4)', () => {
  it('ERROR_CODES tiene los códigos de la fase B', () => {
    expect(ERROR_CODES).toEqual(
      expect.arrayContaining([
        'TOKEN_INVALID_OR_EXPIRED',
        'TOKEN_ATTEMPTS_EXCEEDED',
        'EMAIL_NOT_VERIFIED',
      ]),
    );
  });

  it('publicUserSchema exige emailVerified', () => {
    const withoutFlag: Record<string, unknown> = { ...auth.user };
    delete withoutFlag.emailVerified;
    expect(publicUserSchema.safeParse(withoutFlag).success).toBe(false);
    expect(publicUserSchema.safeParse(auth.user).success).toBe(true);
  });

  it('accountResponseSchema.user lleva emailVerifiedAt y unverifiedDeletionAt (nulos o fechas)', () => {
    const user = accountResponseSchema.shape.user;
    const base = { ...auth.user, emailVerified: false, birthDate: '1990-05-05' };
    expect(
      user.safeParse({
        ...base,
        emailVerifiedAt: null,
        unverifiedDeletionAt: '2026-11-18T10:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(user.safeParse(base).success).toBe(false);
  });

  it('pendingIdentityResponseSchema admite accountEmailVerified opcional', () => {
    const pending = {
      kind: 'link',
      provider: 'google',
      email: 'beto@example.com',
      entryPoint: 'login',
      expiresAt: '2026-11-11T10:30:00.000Z',
    };
    expect(pendingIdentityResponseSchema.parse(pending)).toEqual(pending);
    expect(
      pendingIdentityResponseSchema.parse({ ...pending, accountEmailVerified: false }),
    ).toEqual({ ...pending, accountEmailVerified: false });
  });
});
