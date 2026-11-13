import type { RequestEvent } from '@sveltejs/kit';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const target = vi.hoisted(() => ({ url: 'http://127.0.0.1:1' }));
vi.mock('$app/env/private', () => ({
  get API_URL() {
    return target.url;
  },
  INTERNAL_API_KEY: 'clave-interna-de-prueba-0123456789abcdef',
}));
const { api } = await import('./api-client.ts');

const reply = (status: string, headers = '', body = '') =>
  `HTTP/1.1 ${status}\r\n${headers}Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`;

let raw = '';
let received = 0;
const sockets = new Set<Socket>();
let server: Server;
beforeAll(async () => {
  server = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.once('data', () => {
      received += 1;
      socket.end(raw);
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  target.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => {
  received = 0;
  for (const socket of sockets) socket.destroy();
});
afterAll(async () => {
  await new Promise((done) => server.close(done));
});

const event = { getClientAddress: () => '127.0.0.1' } as unknown as RequestEvent;
const T = 'T'.repeat(43);
const register = () =>
  api.register(event, {
    email: 'ana@example.com',
    password: 'una frase larga de prueba',
    birthDate: '1990-05-05',
    acceptTerms: true,
    termsVersion: '2026-11-borrador',
  });
const del = () => api.deleteAccount(event, T, { password: 'una frase' });
const UNKNOWN = { ok: false, status: 503, error: { code: 'OUTCOME_UNKNOWN' } };
const proxy5xx = (status: string) => reply(status, 'Content-Type: text/html\r\n', 'Bad Gateway');

describe('QA quinta revisión: expectStatus y la regla del 5xx solo afectan a registro y borrado', () => {
  it.each([
    '502 Bad Gateway',
    '503 Service Unavailable',
    '504 Gateway Timeout',
    '500 Internal Server Error',
  ])(
    '%s sin cuerpo de la API: registro y borrado → OUTCOME_UNKNOWN, con una sola petición cada uno',
    async (status) => {
      raw = proxy5xx(status);
      expect(await register()).toEqual(UNKNOWN);
      expect(await del()).toEqual(UNKNOWN);
      expect(received).toBe(2);
    },
  );

  it('un 5xx con JSON que no es el cuerpo de error de la API (de un proxy) → OUTCOME_UNKNOWN', async () => {
    raw = reply('502 Bad Gateway', 'Content-Type: application/json\r\n', '{"message":"upstream"}');
    expect(await register()).toEqual(UNKNOWN);
    expect(await del()).toEqual(UNKNOWN);
  });

  it.each([
    ['login', () => api.login(event, { email: 'ana@example.com', password: 'una frase' })],
    ['logout', () => api.logout(event, T)],
    ['session', () => api.session(event, T)],
    ['account', () => api.account(event, T)],
  ])(
    '%s con un 502 o 504 sin cuerpo → API_UNAVAILABLE con su mismo estado (sin cambios)',
    async (_n, call) => {
      for (const status of ['502 Bad Gateway', '504 Gateway Timeout']) {
        raw = proxy5xx(status);
        expect(await call()).toEqual({
          ok: false,
          status: Number(status.slice(0, 3)),
          error: { code: 'API_UNAVAILABLE' },
        });
      }
    },
  );

  it('logout: cualquier 2xx sigue siendo éxito (no tiene expectStatus)', async () => {
    for (const status of ['200 OK', '204 No Content']) {
      raw = reply(status);
      expect(await api.logout(event, T)).toMatchObject({ ok: true });
    }
  });

  it.each(['200 OK', '201 Created', '202 Accepted', '205 Reset Content'])(
    'borrado con %s → OUTCOME_UNKNOWN; solo el 204 confirma',
    async (status) => {
      raw = reply(status);
      expect(await del()).toEqual(UNKNOWN);
    },
  );

  it('borrado con un 204 que trae cuerpo (inesperado) sigue siendo éxito', async () => {
    raw = reply('204 No Content');
    expect(await del()).toEqual({ ok: true, status: 204, data: undefined });
  });

  it('un 4xx sin cuerpo (un proxy que no llegó a la API) no es incierto: API_UNAVAILABLE 502', async () => {
    raw = proxy5xx('413 Payload Too Large');
    expect(await register()).toEqual({
      ok: false,
      status: 502,
      error: { code: 'API_UNAVAILABLE' },
    });
    expect(await del()).toEqual({ ok: false, status: 502, error: { code: 'API_UNAVAILABLE' } });
  });

  it('errores propios de la API (4xx con cuerpo) no cambian', async () => {
    raw = reply(
      '409 Conflict',
      'Content-Type: application/json\r\n',
      '{"error":{"code":"EMAIL_TAKEN","message":"x"}}',
    );
    expect(await register()).toMatchObject({
      ok: false,
      status: 409,
      error: { code: 'EMAIL_TAKEN' },
    });
  });
});
