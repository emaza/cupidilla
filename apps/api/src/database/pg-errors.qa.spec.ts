import { DrizzleQueryError } from 'drizzle-orm';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toErrorResponse } from '../common/errors/api-exception.filter.js';
import { createPool } from './database.module.js';
import { isConnectionLost } from './pg-errors.js';

const pgError = (message: string, code?: string): Error =>
  Object.assign(new Error(message), code === undefined ? {} : { code });
const wrapped = (cause: Error) => new DrizzleQueryError('insert into "users" …', [], cause);

describe('QA cuarta revisión: isConnectionLost no marca como incierto lo que se sabe que falló', () => {
  it.each([
    ['DNS: ENOTFOUND', pgError('getaddrinfo ENOTFOUND db', 'ENOTFOUND')],
    ['DNS: EAI_AGAIN', pgError('getaddrinfo EAI_AGAIN db', 'EAI_AGAIN')],
    ['ECONNREFUSED', pgError('connect ECONNREFUSED 127.0.0.1:5432', 'ECONNREFUSED')],
    ['53300 demasiadas conexiones', pgError('too many clients already', '53300')],
    [
      '25P03 idle_in_transaction_session_timeout: el servidor ya deshizo',
      pgError('terminating connection due to idle-in-transaction timeout', '25P03'),
    ],
    [
      'cliente roto tras perder la sesión (la transacción ya está deshecha)',
      pgError('Client has encountered a connection error and is not queryable'),
    ],
    ['sin hueco en el pool', pgError('timeout exceeded when trying to connect')],
    ['23503 violación de clave ajena', pgError('fk', '23503')],
    ['40001 fallo de serialización', pgError('could not serialize', '40001')],
    ['40P01 deadlock: el servidor deshace', pgError('deadlock detected', '40P01')],
  ])('%s → no es incierto (500 en un POST)', (_, error) => {
    expect(isConnectionLost(error)).toBe(false);
    expect(isConnectionLost(wrapped(error))).toBe(false);
    expect(toErrorResponse(wrapped(error), 'POST').status).toBe(500);
  });

  it('un POST con un error sin relación con la base de datos sigue siendo 500', () => {
    expect(
      toErrorResponse(new Error('Query read timeout in the message of another thing'), 'POST')
        .status,
    ).toBe(500);
    expect(toErrorResponse(new TypeError('x is not a function'), 'DELETE').status).toBe(500);
  });
});

/** PostgreSQL falso que contesta al saludo con un error FATAL y cierra, como uno que arranca o se apaga. */
function fatalOnStartup(
  code: string,
  message: string,
): Promise<{ server: Server; url: string; sockets: Set<Socket> }> {
  const sockets = new Set<Socket>();
  const fields = ['S', 'FATAL', 'V', 'FATAL', 'C', code, 'M', message];
  const body = Buffer.concat([
    ...fields.map((field, index) => Buffer.from(index % 2 === 0 ? field : `${field}\0`)),
    Buffer.from('\0'),
  ]);
  const header = Buffer.alloc(5);
  header.write('E');
  header.writeInt32BE(body.length + 4, 1);
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.once('data', () => socket.end(Buffer.concat([header, body])));
  });
  return new Promise((done) =>
    server.listen(0, '127.0.0.1', () =>
      done({
        server,
        sockets,
        url: `postgres://u:p@127.0.0.1:${(server.address() as AddressInfo).port}/x`,
      }),
    ),
  );
}

describe('[BUG-QA-10] errores al CONECTAR (no se envió nada) tampoco deben ser «resultado incierto»', () => {
  let fake: Awaited<ReturnType<typeof fatalOnStartup>>;
  beforeAll(async () => {
    fake = await fatalOnStartup('57P03', 'the database system is starting up');
  });
  afterAll(async () => {
    for (const socket of fake.sockets) socket.destroy();
    await new Promise((done) => fake.server.close(done));
  });

  it('57P03 al abrir la conexión (PostgreSQL arrancando): ninguna consulta salió → 500 y no 503 OUTCOME_UNKNOWN', async () => {
    const pool = createPool({
      DATABASE_URL: fake.url,
      DB_CONNECTION_TIMEOUT_MS: 1000,
      DB_STATEMENT_TIMEOUT_MS: 1000,
      DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: 10_000,
    });
    try {
      const error = await pool.connect().then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as { code?: string }).code).toBe('57P03');
      expect(toErrorResponse(error, 'POST').body.error.code).toBe('INTERNAL_ERROR');
    } finally {
      await pool.end().catch(() => undefined);
    }
  });
});
