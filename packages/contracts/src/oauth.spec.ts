import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ERROR_CODES } from './errors.js';
import {
  oauthAuthResponseSchema,
  oauthCallbackResponseSchema,
  oauthLinkRequestSchema,
  oauthSessionStartRequestSchema,
  oauthSignupRequestSchema,
  oauthStartRequestSchema,
} from './oauth.js';
import {
  ACCOUNT_SESSIONS_LIMIT,
  accountResponseSchema,
  deleteAccountRequestSchema,
  reauthenticateRequestSchema,
} from './users.js';

function issues(schema: z.ZodType, input: unknown): string[] {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

const TOKEN = 'A'.repeat(43);
const EXPIRES = '2026-11-13T10:30:00.000Z';
const user = {
  id: '6f1c2b0e-8d4a-4f6e-9c3b-2a1d0e9f8b7c',
  email: 'ana@example.com',
  createdAt: '2026-11-13T10:00:00.000Z',
};

describe('oauthCallbackResponseSchema (C-O1)', () => {
  const variants = [
    {
      result: 'signed_in',
      user,
      session: { token: TOKEN, expiresAt: EXPIRES },
      returnPath: '/account/delete',
    },
    { result: 'signed_in', user, session: { token: TOKEN, expiresAt: EXPIRES }, returnPath: null },
    { result: 'signup_required', pending: { token: TOKEN, expiresAt: EXPIRES } },
    { result: 'link_required', pending: { token: TOKEN, expiresAt: EXPIRES } },
    { result: 'use_other_provider', providers: ['google'] },
    { result: 'reauthenticated', returnPath: '/account/password' },
    { result: 'connected' },
    {
      result: 'connect_confirmed',
      next: {
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=x',
        flowToken: TOKEN,
        expiresAt: EXPIRES,
      },
    },
    { result: 'password_created' },
    { result: 'failed', reason: 'cancelled', entryPoint: 'login', returnPath: null },
    { result: 'failed', reason: 'connect_refused', entryPoint: 'account', returnPath: '/account' },
    {
      result: 'failed',
      reason: 'password_already_set',
      entryPoint: 'account',
      returnPath: '/account/password',
    },
    {
      result: 'failed',
      reason: 'identity_mismatch',
      entryPoint: 'account',
      returnPath: '/account',
    },
  ];

  it.each(variants)('acepta la variante $result', (variant) => {
    expect(oauthCallbackResponseSchema.safeParse(variant).success).toBe(true);
  });

  it('rechaza un result desconocido y las variantes incompletas', () => {
    expect(oauthCallbackResponseSchema.safeParse({ result: 'linked' }).success).toBe(false);
    expect(
      oauthCallbackResponseSchema.safeParse({ result: 'use_other_provider', providers: [] })
        .success,
    ).toBe(false);
    expect(
      oauthCallbackResponseSchema.safeParse({
        result: 'failed',
        reason: 'otro',
        entryPoint: 'login',
        returnPath: null,
      }).success,
    ).toBe(false);
    expect(
      oauthCallbackResponseSchema.safeParse({
        result: 'signup_required',
        pending: { token: 'corto', expiresAt: EXPIRES },
      }).success,
    ).toBe(false);
    expect(oauthCallbackResponseSchema.safeParse({ result: 'connect_confirmed' }).success).toBe(
      false,
    );
    expect(
      oauthCallbackResponseSchema.safeParse({
        result: 'connect_confirmed',
        next: { authorizationUrl: 'no es una url', flowToken: TOKEN, expiresAt: EXPIRES },
      }).success,
    ).toBe(false);
  });
});

describe('returnPath (C-O1)', () => {
  const start = (returnPath: unknown) =>
    issues(oauthStartRequestSchema, { entryPoint: 'login', returnPath });

  it('acepta rutas propias en minúsculas y que falte', () => {
    expect(start('/account')).toEqual([]);
    expect(start('/account/password')).toEqual([]);
    expect(issues(oauthStartRequestSchema, { entryPoint: 'register' })).toEqual([]);
  });

  it('rechaza //x, /X, rutas sin barra inicial y más de 64 caracteres', () => {
    expect(start('//x')).toEqual(['invalid_format']);
    expect(start('/account//evil')).toEqual(['invalid_format']);
    expect(start('/X')).toEqual(['invalid_format']);
    expect(start('account')).toEqual(['invalid_format']);
    expect(start('https://evil.example')).toEqual(['invalid_format']);
    expect(start('/account?next=x')).toEqual(['invalid_format']);
    expect(start(`/${'a'.repeat(63)}`)).toEqual([]);
    expect(start(`/${'a'.repeat(64)}`)).toEqual(['too_long']);
  });

  it('se aplica también en las respuestas', () => {
    const response = (returnPath: unknown) =>
      oauthAuthResponseSchema.safeParse({
        user,
        session: { token: TOKEN, expiresAt: EXPIRES },
        returnPath,
      }).success;
    expect(response('/account')).toBe(true);
    expect(response(null)).toBe(true);
    expect(response('//evil.example')).toBe(false);
  });
});

describe('peticiones de OAuth (C-O1)', () => {
  it('oauthStartRequestSchema y oauthSessionStartRequestSchema solo admiten sus valores', () => {
    expect(issues(oauthStartRequestSchema, { entryPoint: 'account' })).toEqual(['invalid']);
    expect(issues(oauthStartRequestSchema, { entryPoint: 'login', extra: 1 })).toEqual([
      'unrecognized',
    ]);
    expect(issues(oauthSessionStartRequestSchema, { purpose: 'connect' })).toEqual([]);
    expect(issues(oauthSessionStartRequestSchema, { purpose: 'sign_in' })).toEqual(['invalid']);
    expect(issues(oauthSessionStartRequestSchema, {})).toEqual(['invalid']);
    expect(
      issues(oauthSessionStartRequestSchema, { purpose: 'connect', password: 'x', extra: 1 }),
    ).toEqual(['unrecognized']);
  });

  it('oauthLinkRequestSchema normaliza el correo', () => {
    const parsed = oauthLinkRequestSchema.parse({
      pendingToken: TOKEN,
      email: '  Ana@Example.COM ',
      password: 'x',
    });
    expect(parsed.email).toBe('ana@example.com');
  });

  it('oauthSignupRequestSchema exige las condiciones y no admite el correo', () => {
    const valid = {
      pendingToken: TOKEN,
      birthDate: '1990-05-05',
      acceptTerms: true,
      termsVersion: '2026-11-borrador',
    };
    expect(issues(oauthSignupRequestSchema, valid)).toEqual([]);
    expect(issues(oauthSignupRequestSchema, { ...valid, acceptTerms: false })).toEqual([
      'required',
    ]);
    expect(issues(oauthSignupRequestSchema, { ...valid, email: 'a@b.es' })).toEqual([
      'unrecognized',
    ]);
    expect(issues(oauthSignupRequestSchema, { ...valid, pendingToken: 'x' })).toEqual([
      'invalid_format',
    ]);
  });
});

describe('cuentas sin contraseña (C-O1)', () => {
  it('create_password aplica los límites de newPasswordSchema (decisión 21)', () => {
    const create = (input: object) =>
      issues(oauthSessionStartRequestSchema, { purpose: 'create_password', ...input });
    expect(create({ password: 'a'.repeat(9) })).toEqual(['too_short']);
    expect(create({ password: 'a'.repeat(10) })).toEqual([]);
    expect(create({ password: 'a'.repeat(10), returnPath: '/account/password' })).toEqual([]);
    expect(create({ password: 'a'.repeat(129) })).toEqual(['too_long']);
    expect(create({})).toEqual(['required']);
    expect(create({ password: 'a'.repeat(10), extra: 1 })).toEqual(['unrecognized']);
  });

  it('reauthenticateRequestSchema exige la contraseña', () => {
    expect(issues(reauthenticateRequestSchema, { password: 'x' })).toEqual([]);
    expect(issues(reauthenticateRequestSchema, {})).toEqual(['required']);
  });

  it('deleteAccountRequestSchema admite el cuerpo sin contraseña, pero no una vacía', () => {
    expect(issues(deleteAccountRequestSchema, {})).toEqual([]);
    expect(issues(deleteAccountRequestSchema, { password: 'x' })).toEqual([]);
    expect(issues(deleteAccountRequestSchema, { password: '' })).toEqual(['required']);
    expect(issues(deleteAccountRequestSchema, { confirmation: 'ELIMINAR' })).toEqual([
      'unrecognized',
    ]);
  });

  it('accountResponseSchema lleva las formas de entrar, la fecha de autenticación y las sesiones', () => {
    const openSession = {
      createdAt: '2026-11-13T10:00:00.000Z',
      authenticatedAt: '2026-11-13T10:00:00.000Z',
      expiresAt: '2026-12-13T10:00:00.000Z',
      current: true,
    };
    const account = {
      user: { ...user, birthDate: '1990-05-05' },
      consents: [],
      signInMethods: {
        password: false,
        identities: [
          {
            provider: 'google',
            linkedAt: '2026-11-13T10:00:00.000Z',
            lastUsedAt: '2026-11-13T10:00:00.000Z',
          },
        ],
      },
      session: { authenticatedAt: '2026-11-13T10:00:00.000Z' },
      sessions: [openSession],
    };
    expect(accountResponseSchema.safeParse(account).success).toBe(true);
    expect(accountResponseSchema.safeParse({ ...account, sessions: [] }).success).toBe(true);
    expect(
      accountResponseSchema.safeParse({
        ...account,
        signInMethods: {
          password: false,
          identities: [{ provider: 'github', linkedAt: EXPIRES, lastUsedAt: EXPIRES }],
        },
      }).success,
    ).toBe(false);
    expect(accountResponseSchema.safeParse({ ...account, session: {} }).success).toBe(false);
    // Sin `sessions`, con más del límite o con una identidad sin `lastUsedAt`.
    expect(accountResponseSchema.safeParse({ ...account, sessions: undefined }).success).toBe(
      false,
    );
    expect(
      accountResponseSchema.safeParse({
        ...account,
        sessions: Array.from({ length: ACCOUNT_SESSIONS_LIMIT + 1 }, () => ({
          ...openSession,
          current: false,
        })),
      }).success,
    ).toBe(false);
    expect(
      accountResponseSchema.safeParse({
        ...account,
        signInMethods: {
          password: false,
          identities: [{ provider: 'google', linkedAt: EXPIRES }],
        },
      }).success,
    ).toBe(false);
  });
});

describe('códigos de error nuevos (C-O1)', () => {
  it('REAUTHENTICATION_REQUIRED ya no existe (decisión 21)', () => {
    expect(ERROR_CODES).not.toContain('REAUTHENTICATION_REQUIRED');
  });

  it('están en ERROR_CODES', () => {
    for (const code of [
      'OAUTH_FLOW_INVALID',
      'LINK_ATTEMPTS_EXCEEDED',
      'ACCOUNT_USES_OTHER_PROVIDER',
      'LAST_SIGN_IN_METHOD',
      'PASSWORD_ALREADY_SET',
    ]) {
      expect(ERROR_CODES).toContain(code);
    }
  });
});
