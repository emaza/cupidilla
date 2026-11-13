import { describe, expect, it } from 'vitest';
import { urlMessage } from './oauth-notices.ts';

const message = (query: string) => urlMessage('entry', new URLSearchParams(query));

describe('W-O2: avisos y errores de la URL en /login y /register (técnico §11.4)', () => {
  it('cancelar es un aviso informativo con el nombre del proveedor', () => {
    expect(message('notice=provider-cancelled&provider=google')).toEqual({
      kind: 'notice',
      text: 'No has continuado con Google, así que no hemos hecho ningún cambio. Puedes volver a intentarlo o seguir con tu correo.',
    });
  });

  it('un error de la lista es un error, con el proveedor en el texto', () => {
    expect(message('error=email-missing&provider=facebook')).toMatchObject({
      kind: 'error',
      text: expect.stringMatching(/^Facebook no nos ha enviado tu correo/),
    });
    expect(message('error=provider-expired')).toMatchObject({
      kind: 'error',
      text: expect.stringMatching(/^Ha pasado demasiado tiempo/),
    });
    expect(message('notice=signup-cancelled')).toMatchObject({ kind: 'notice' });
    expect(message('error=link-limit')).toMatchObject({ kind: 'error' });
    expect(message('error=rate-limited')).toMatchObject({ kind: 'error' });
  });

  it.each([
    'notice=otra-cosa',
    'error=identity-in-use&provider=google', // de /account, no de /login
    'error=other-provider', // exige provider
    'error=other-provider&provider=twitter',
    'notice=provider-cancelled', // su texto lleva {proveedor}
    'error=%3Cscript%3E&provider=google',
    '',
  ])('«%s» fuera de lista o sin proveedor válido → no muestra nada', (query) => {
    expect(message(query)).toBeNull();
  });

  it('nunca deja un «{proveedor}» sin sustituir', () => {
    for (const value of [
      'provider-failed',
      'email-missing',
      'email-unverified',
      'other-provider',
    ]) {
      for (const provider of ['google', 'facebook']) {
        expect(message(`error=${value}&provider=${provider}`)?.text).not.toContain('{');
      }
    }
  });

  it('si llegan error y notice, gana el error', () => {
    expect(message('notice=provider-cancelled&error=provider-failed&provider=google')?.kind).toBe(
      'error',
    );
  });
});
