import { describe, expect, it } from 'vitest';
import { envSchema } from './env.schema.js';

const base = {
  INTERNAL_API_KEY: 'k'.repeat(32),
  // Obligatorias desde el hito de correo (§8.1).
  PUBLIC_WEB_URL: 'http://localhost:5173',
  SMTP_URL: 'smtp://127.0.0.1:1025',
};
const db = 'postgres://u:secreto@127.0.0.1:5432/cupidilla';
const rejected = (url: string) =>
  envSchema.safeParse({ ...base, DATABASE_URL: url }).success === false;

describe('QA quinta revisión: DATABASE_URL y los parámetros prohibidos', () => {
  it.each([
    '%73tatement_timeout=0',
    'statement%5Ftimeout=0',
    'STATEMENT_TIMEOUT=0',
    'Query_Timeout=0',
    'idle_in_transaction_session_timeout=1',
    'IDLE_IN_TRANSACTION_SESSION_TIMEOUT=1',
    'connectionTimeoutMillis=0',
    'CONNECTIONTIMEOUTMILLIS=0',
    'connect_timeout=0',
    '%6Fptions=-c%20statement_timeout%3D0',
    'OPTIONS=x',
    'sslmode=require&sslmode=prefer&statement_timeout=0',
    'a=b&%73tatement_timeout=0&c=d',
  ])('rechaza ?%s', (query) => {
    expect(rejected(`${db}?${query}`)).toBe(true);
  });

  it('la clave prohibida solo en el valor o en el fragmento no se rechaza (no la aplica pg)', () => {
    expect(rejected(`${db}?application_name=statement_timeout`)).toBe(false);
    expect(rejected(`${db}#statement_timeout=0`)).toBe(false);
  });
});

describe('[BUG-QA-11] una DATABASE_URL mal formada no debe lanzar una excepción que lleve la URL (y la contraseña)', () => {
  it.each(['', 'no es una url', 'postgres://usuario:clave-secreta-qa5@:puerto-malo/db'])(
    '%j da un error de validación de zod, no un TypeError «Invalid URL»',
    (url) => {
      let thrown: unknown;
      try {
        envSchema.safeParse({ ...base, DATABASE_URL: url });
      } catch (error) {
        thrown = error;
      }
      // Un TypeError de `new URL` lleva la URL entera en `input` y Node la imprime al caer.
      expect(thrown, `lanzó ${String((thrown as Error | undefined)?.message)}`).toBeUndefined();
    },
  );
});
