import { describe, expect, it } from 'vitest';
import { hashSessionToken } from '../../auth/sessions.service.js';
import { accountTracker, ipTracker } from './app-throttler.guard.js';

describe('trackers del límite de intentos', () => {
  it('ip: usa X-Client-Ip y, si falta, req.ip', () => {
    expect(ipTracker({ ip: '127.0.0.1', headers: { 'x-client-ip': '203.0.113.7' } })).toBe(
      '203.0.113.7',
    );
    expect(ipTracker({ ip: '127.0.0.1', headers: {} })).toBe('127.0.0.1');
  });

  it('account: usa el correo normalizado del cuerpo', () => {
    const a = accountTracker({ headers: {}, body: { email: '  Ana@Example.COM ' } });
    const b = accountTracker({ headers: {}, body: { email: 'ana@example.com' } });
    expect(a).toBe(b);
  });

  it('account: sin correo, usa el hash del token de sesión', () => {
    const token = 'a'.repeat(43);
    expect(accountTracker({ headers: { authorization: `Bearer ${token}` }, body: {} })).toBe(
      `session:${hashSessionToken(token)}`,
    );
  });
});
