import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { isConnectionLost, markNotSent } from './pg-errors.js';

const pgError = (message: string, code?: string): Error =>
  Object.assign(new Error(message), code === undefined ? {} : { code });
/** Así llegan los errores de las consultas hechas con Drizzle. */
const wrapped = (cause: Error) => new DrizzleQueryError('delete from "users" where …', [], cause);

describe('isConnectionLost', () => {
  it.each([
    ['query_timeout del cliente', pgError('Query read timeout')],
    ['conexión cerrada por el servidor', pgError('Connection terminated unexpectedly')],
    ['conexión cerrada', pgError('Connection terminated')],
    ['ECONNRESET', pgError('read ECONNRESET', 'ECONNRESET')],
    ['EPIPE', pgError('write EPIPE', 'EPIPE')],
    ['57P01 admin_shutdown', pgError('terminating connection', '57P01')],
    ['57P02 crash_shutdown', pgError('terminating connection', '57P02')],
    ['08006 connection_failure', pgError('connection failure', '08006')],
    ['08P01 protocol_violation', pgError('protocol violation', '08P01')],
  ])('%s → sí, también envuelto por Drizzle', (_, error) => {
    expect(isConnectionLost(error)).toBe(true);
    expect(isConnectionLost(wrapped(error))).toBe(true);
  });

  it.each([
    ['statement_timeout (57014): el servidor cancela y deshace', pgError('canceling', '57014')],
    ['violación de unicidad', pgError('duplicate key', '23505')],
    ['error de sintaxis', pgError('syntax error', '42601')],
    ['sin conexión libre a tiempo', pgError('timeout exceeded when trying to connect')],
    [
      'tiempo de conexión agotado (aunque envuelva un «Connection terminated»)',
      new Error('Connection terminated due to connection timeout', {
        cause: pgError('Connection terminated unexpectedly'),
      }),
    ],
    ['conexión rechazada', pgError('connect ECONNREFUSED 127.0.0.1:5432', 'ECONNREFUSED')],
    ['57P03 cannot_connect_now: solo ocurre al conectar', pgError('starting up', '57P03')],
    ['un error marcado como de adquisición', markNotSent(pgError('terminating', '57P01'))],
    ['un error marcado, aunque sea de red', markNotSent(pgError('read ECONNRESET', 'ECONNRESET'))],
    ['un error cualquiera', new Error('boom')],
  ])('%s → no', (_, error) => {
    expect(isConnectionLost(error)).toBe(false);
    expect(isConnectionLost(wrapped(error))).toBe(false);
  });

  it('lo que no es un Error → no', () => {
    expect(isConnectionLost('Query read timeout')).toBe(false);
    expect(isConnectionLost(undefined)).toBe(false);
  });
});
