import { describe, expect, it } from 'vitest';
import { assertApiUrlTransport } from './api-url.ts';

describe('QA quinta revisión: assertApiUrlTransport', () => {
  it.each([
    'http://localhost.evil.com:3001',
    'http://127.0.0.1.evil.com',
    'http://evil.com#@127.0.0.1',
    'http://127.0.0.1@evil.com',
    'http://localhost@evil.com:3001',
    'http://evil.com\\@localhost',
    'http://[::2]:3001',
    'http://0.0.0.0:3001',
    'http://10.0.0.5',
  ])('rechaza %s sin API_URL_ALLOW_HTTP', (url) => {
    expect(() => assertApiUrlTransport(url, false)).toThrow(/API_URL_ALLOW_HTTP/);
  });

  it.each([
    'HTTP://LOCALHOST:3001',
    'http://127.0.0.1',
    'http://[::1]',
    'http://user:pass@127.0.0.1:3001',
    'http://2130706433:3001',
    'HTTPS://api.example.com',
  ])('acepta %s', (url) => {
    expect(() => assertApiUrlTransport(url, false)).not.toThrow();
  });

  it('el error no contiene la URL, ni sus credenciales ni el host', () => {
    for (const url of [
      'http://usuario:clave-secreta@api.interno:3001',
      'ftp://usuario:clave-secreta@api.interno',
    ]) {
      try {
        assertApiUrlTransport(url, false);
        expect.unreachable();
      } catch (error) {
        const text =
          JSON.stringify(error) + String((error as Error).message) + String((error as Error).stack);
        expect(text).not.toContain('clave-secreta');
        expect(text).not.toContain('api.interno');
      }
    }
  });
});
