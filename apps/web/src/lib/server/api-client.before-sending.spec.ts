import { createServer, type AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/env/private', () => ({
  API_URL: 'http://127.0.0.1:1',
  INTERNAL_API_KEY: 'clave-interna-de-prueba-0123456789abcdef',
}));

const { failedBeforeSending } = await import('./api-client.ts');

const fetchError = (cause: unknown) => new TypeError('fetch failed', { cause });
const withCode = (code: string) => Object.assign(new Error(code), { code });

describe('QA: failedBeforeSending (§8.4)', () => {
  it.each([
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EADDRNOTAVAIL',
    'UND_ERR_CONNECT_TIMEOUT',
  ])('%s en la causa: no se envió nada', (code) => {
    expect(failedBeforeSending(fetchError(withCode(code)))).toBe(true);
  });

  it('con varias direcciones (AggregateError) basta con que haya un código de «no enviado»', () => {
    const aggregate = new AggregateError([withCode('ECONNREFUSED'), withCode('ECONNREFUSED')]);
    expect(failedBeforeSending(fetchError(aggregate))).toBe(true);
  });

  it.each([
    [
      'tiempo agotado',
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
    ],
    ['ECONNRESET', fetchError(withCode('ECONNRESET'))],
    ['UND_ERR_SOCKET', fetchError(withCode('UND_ERR_SOCKET'))],
    ['sin causa', new TypeError('fetch failed')],
    ['causa que no es un objeto', fetchError('ECONNREFUSED')],
    ['null', null],
    ['undefined', undefined],
    ['un texto', 'ECONNREFUSED'],
    [
      'AggregateError sin códigos conocidos',
      fetchError(new AggregateError([withCode('ECONNRESET')])),
    ],
    ['código que no es texto', fetchError({ code: 111 })],
  ])('%s: puede haberse enviado → no es «antes de enviar»', (_name, error) => {
    expect(failedBeforeSending(error)).toBe(false);
  });

  it('un fetch real a «localhost» sin nadie escuchando se reconoce como «no enviado»', async () => {
    const probe = createServer();
    await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
    const { port } = probe.address() as AddressInfo;
    await new Promise((done) => probe.close(done));
    // `localhost` puede resolver a ::1 y a 127.0.0.1: Node lo informa como AggregateError.
    const error = await fetch(`http://localhost:${port}/`).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(failedBeforeSending(error)).toBe(true);
  });
});
