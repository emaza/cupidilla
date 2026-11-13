import { describe, expect, it } from 'vitest';
import { assertApiUrlTransport } from './api-url.ts';

describe('assertApiUrlTransport', () => {
  it.each([
    'https://api.example.com',
    'https://10.0.0.5:3001',
    'http://127.0.0.1:3001',
    'http://localhost:3001',
    'http://[::1]:3001',
  ])('acepta %s sin API_URL_ALLOW_HTTP', (url) => {
    expect(() => assertApiUrlTransport(url, false)).not.toThrow();
  });

  it.each(['http://api:3001', 'http://10.0.0.5:3001', 'http://api.example.com'])(
    'rechaza %s sin API_URL_ALLOW_HTTP, sin mostrar la URL',
    (url) => {
      expect(() => assertApiUrlTransport(url, false)).toThrow(/API_URL_ALLOW_HTTP/);
      expect(() => assertApiUrlTransport(url, false)).not.toThrow(new URL(url).hostname);
    },
  );

  it('con API_URL_ALLOW_HTTP=true acepta http: en una red privada', () => {
    expect(() => assertApiUrlTransport('http://api:3001', true)).not.toThrow();
  });

  it('otros protocolos no valen nunca', () => {
    expect(() => assertApiUrlTransport('ftp://127.0.0.1', true)).toThrow(/https/);
  });

  it('una URL ilegible da un error propio, sin la URL ni la contraseña', () => {
    const bad = 'http://usuario:clave-secreta@:puerto-malo/x';
    expect(() => assertApiUrlTransport(bad, false)).toThrow('API_URL no es una URL válida.');
    let thrown: unknown;
    try {
      assertApiUrlTransport(bad, false);
    } catch (error) {
      thrown = error;
    }
    expect(JSON.stringify(thrown) + String(thrown)).not.toContain('clave-secreta');
    expect(thrown).not.toBeInstanceOf(TypeError);
  });
});
