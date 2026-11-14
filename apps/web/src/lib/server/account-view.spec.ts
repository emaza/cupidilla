import type { AccountResponse } from '@cupidilla/contracts';
import { describe, expect, it } from 'vitest';
import {
  accountDetailsView,
  formatDateTime,
  formatDay,
  formatPlainDate,
  openSessionsView,
  signInMethodsView,
} from './account-view.ts';

const account: AccountResponse = {
  user: {
    id: '6f1c2b0e-8d4a-4f6e-9c3b-2a1d0e9f8b7c',
    email: 'ana@example.com',
    createdAt: '2026-11-10T23:30:00.000Z',
    birthDate: '1990-01-01',
  },
  consents: [
    {
      purpose: 'service_use',
      policyVersion: '2026-11-borrador-2',
      grantedAt: '2026-11-10T23:30:00.000Z',
      revokedAt: null,
    },
  ],
  signInMethods: {
    password: true,
    identities: [
      {
        provider: 'google',
        linkedAt: '2026-11-11T10:00:00.000Z',
        lastUsedAt: '2026-11-12T17:45:00.000Z',
      },
    ],
  },
  session: { authenticatedAt: '2026-11-12T09:05:00.000Z' },
  sessions: [
    {
      createdAt: '2026-11-01T08:00:00.000Z',
      authenticatedAt: '2026-11-12T09:05:00.000Z',
      expiresAt: '2026-12-12T09:05:00.000Z',
      current: true,
    },
    {
      createdAt: '2026-11-10T08:00:00.000Z',
      authenticatedAt: '2026-11-10T08:00:00.000Z',
      expiresAt: '2026-12-10T08:00:00.000Z',
      current: false,
    },
  ],
};

describe('formateo de fechas en /account', () => {
  it('la fecha de nacimiento no cambia de día con la zona horaria', () => {
    // El 1 de enero a medianoche UTC es 31 de diciembre en cualquier zona al oeste de Greenwich.
    expect(formatPlainDate('1990-01-01')).toEqual({
      iso: '1990-01-01',
      text: '1 de enero de 1990',
    });
    expect(formatPlainDate('2000-12-31')?.text).toBe('31 de diciembre de 2000');
  });

  it('el alta y las demás fechas van en hora de Madrid', () => {
    // 23:30 UTC del 10 de noviembre ya es 11 de noviembre en Madrid (UTC+1).
    expect(formatDay('2026-11-10T23:30:00.000Z')?.text).toBe('11 de noviembre de 2026');
    expect(formatDateTime('2026-11-12T09:05:00.000Z')).toEqual({
      iso: '2026-11-12T09:05:00.000Z',
      text: '12 de noviembre de 2026 a las 10:05',
    });
  });

  it('una fecha que no se puede leer devuelve null', () => {
    expect(formatDay('no es una fecha')).toBeNull();
    expect(formatDateTime('')).toBeNull();
    expect(formatPlainDate('1990-1-1')).toBeNull();
    expect(formatPlainDate('1990-13-01')).toBeNull();
  });
});

describe('vistas de /account', () => {
  it('«Tus datos» lleva nacimiento, alta, inicio de la sesión y condiciones', () => {
    expect(accountDetailsView(account)).toEqual({
      email: 'ana@example.com',
      birthDate: { iso: '1990-01-01', text: '1 de enero de 1990' },
      createdOn: { iso: '2026-11-10T23:30:00.000Z', text: '11 de noviembre de 2026' },
      sessionSince: {
        iso: '2026-11-12T09:05:00.000Z',
        text: '12 de noviembre de 2026 a las 10:05',
      },
      terms: { version: '2026-11-borrador-2', acceptedOn: '11 de noviembre de 2026' },
    });
  });

  it('una fecha no válida se omite (null) sin romper el resto', () => {
    const view = accountDetailsView({
      ...account,
      user: { ...account.user, createdAt: 'x' },
      session: { authenticatedAt: 'x' },
    });
    expect(view.createdOn).toBeNull();
    expect(view.sessionSince).toBeNull();
    expect(view.birthDate?.text).toBe('1 de enero de 1990');
  });

  it('las sesiones se numeran en el orden de la API, sin reordenar', () => {
    const sessions = openSessionsView(account);
    expect(sessions.map((item) => [item.n, item.current])).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(sessions[0]).toMatchObject({
      createdAt: { iso: '2026-11-01T08:00:00.000Z', text: '1 de noviembre de 2026 a las 9:00' },
      expiresAt: { iso: '2026-12-12T09:05:00.000Z', text: '12 de diciembre de 2026 a las 10:05' },
    });
    expect(openSessionsView({ ...account, sessions: [] })).toEqual([]);
  });

  it('cada proveedor unido lleva la fecha de unión y la de último uso', () => {
    expect(signInMethodsView(account, ['google', 'facebook']).linked).toEqual([
      {
        provider: 'google',
        linkedOn: '11 de noviembre de 2026',
        lastUsedOn: '12 de noviembre de 2026 a las 18:45',
      },
    ]);
  });
});
