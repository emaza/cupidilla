import type { RequestEvent } from '@sveltejs/kit';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// La API es un servidor TCP falso: así los errores son los que da `fetch` de verdad.
const target = vi.hoisted(() => ({ url: 'http://127.0.0.1:1' }));
vi.mock('$app/env/private', () => ({
  get API_URL() {
    return target.url;
  },
  INTERNAL_API_KEY: 'clave-interna-de-prueba-0123456789abcdef',
}));

const { api } = await import('./api-client.ts');

type Mode = 'silent' | 'close' | 'reset' | 'truncated' | 'off-schema' | 'api-outcome-unknown';

/** Respuestas 201 que llegan pero no se pueden usar. */
const BROKEN_201: Partial<Record<Mode, string>> = {
  // Anuncia 200 bytes, manda unos pocos y corta.
  truncated:
    'HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: 200\r\n\r\n{"user":{"id":',
  'off-schema':
    'HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: 16\r\nConnection: close\r\n\r\n{"inesperado":1}',
  // No es un 201: es la API diciendo que perdió la conexión con la base de datos (§6.3).
  'api-outcome-unknown':
    'HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\nContent-Length: 64\r\nConnection: close\r\n\r\n{"error":{"code":"OUTCOME_UNKNOWN","message":"Outcome unknown"}}',
};

let mode: Mode = 'silent';
let received = 0;
const sockets = new Set<Socket>();
let server: Server;
let serverUrl = '';

/** Un puerto en el que no escucha nadie: la conexión se rechaza antes de enviar nada. */
async function closedPortUrl(): Promise<string> {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
  const { port } = probe.address() as AddressInfo;
  await new Promise((done) => probe.close(done));
  return `http://127.0.0.1:${port}`;
}

beforeAll(async () => {
  server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    socket.once('data', () => {
      received += 1;
      // silent: nunca responde. close: cierra sin responder. reset: corta con RST.
      if (mode === 'close') socket.end();
      if (mode === 'reset') socket.resetAndDestroy();
      const broken = BROKEN_201[mode];
      if (broken) socket.end(broken);
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const socket of sockets) socket.destroy();
  // Se deja que `fetch` vea el cierre: si no, el siguiente test reutilizaría una conexión muerta.
  await new Promise((done) => setTimeout(done, 50));
  received = 0;
});

afterAll(async () => {
  await new Promise((done) => server.close(done));
});

const event = { getClientAddress: () => '127.0.0.1' } as unknown as RequestEvent;
const register = () =>
  api.register(event, {
    email: 'ana@example.com',
    password: 'una frase larga de prueba',
    birthDate: '1990-05-05',
    acceptTerms: true,
    termsVersion: '2026-11-borrador',
  });
const deleteAccount = () => api.deleteAccount(event, 'T'.repeat(43), { password: 'una frase' });
const login = () => api.login(event, { email: 'ana@example.com', password: 'una frase' });

/** El plazo de 5 s se acorta para el test; el error sigue siendo el `TimeoutError` real. */
function shortTimeout(): void {
  const original = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => original(150));
}

describe('api-client: resultado incierto (OUTCOME_UNKNOWN)', () => {
  it('conexión rechazada antes de enviar → API_UNAVAILABLE, también en registro y borrado', async () => {
    target.url = await closedPortUrl();
    for (const call of [register, deleteAccount, login]) {
      expect(await call()).toEqual({ ok: false, status: 503, error: { code: 'API_UNAVAILABLE' } });
    }
  });

  it('tiempo agotado tras enviar → OUTCOME_UNKNOWN en registro y borrado, con una sola petición', async () => {
    target.url = serverUrl;
    mode = 'silent';
    shortTimeout();
    expect(await register()).toEqual({
      ok: false,
      status: 503,
      error: { code: 'OUTCOME_UNKNOWN' },
    });
    expect(await deleteAccount()).toMatchObject({ error: { code: 'OUTCOME_UNKNOWN' } });
    expect(received).toBe(2); // una por llamada: sin reintentos
  });

  it.each<Mode>(['close', 'reset'])(
    'conexión cortada tras enviar (%s) → OUTCOME_UNKNOWN, sin reintentar',
    async (cut) => {
      target.url = serverUrl;
      mode = cut;
      expect(await register()).toMatchObject({ status: 503, error: { code: 'OUTCOME_UNKNOWN' } });
      expect(received).toBe(1);
      expect(await deleteAccount()).toMatchObject({ error: { code: 'OUTCOME_UNKNOWN' } });
      expect(received).toBe(2);
    },
  );

  it.each<Mode>(['truncated', 'off-schema'])(
    'un 201 con el cuerpo inservible (%s) → OUTCOME_UNKNOWN en registro; API_UNAVAILABLE en login',
    async (broken) => {
      target.url = serverUrl;
      mode = broken;
      expect(await register()).toEqual({
        ok: false,
        status: 503,
        error: { code: 'OUTCOME_UNKNOWN' },
      });
      expect(await login()).toEqual({ ok: false, status: 502, error: { code: 'API_UNAVAILABLE' } });
      expect(received).toBe(2);
    },
  );

  it('un 503 OUTCOME_UNKNOWN de la API llega tal cual en registro, borrado y login', async () => {
    target.url = serverUrl;
    mode = 'api-outcome-unknown';
    const expected = { ok: false, status: 503, error: { code: 'OUTCOME_UNKNOWN' } };
    expect(await register()).toEqual(expected);
    expect(await deleteAccount()).toEqual(expected);
    // En login, messages.ts lo convierte en entrar.error.servidor (criterio 65).
    expect(await login()).toEqual(expected);
    expect(received).toBe(3);
  });

  it.each<Mode>(['silent', 'close', 'reset'])(
    'una petición no marcada (login) sigue dando API_UNAVAILABLE (%s)',
    async (failure) => {
      target.url = serverUrl;
      mode = failure;
      shortTimeout();
      expect(await login()).toEqual({ ok: false, status: 503, error: { code: 'API_UNAVAILABLE' } });
      expect(received).toBe(1);
    },
  );
});
