import { describe, expect, it } from 'vitest';
import type { SignInMethodsView } from './account-view.ts';
import { connectMessages, urlMessage } from './oauth-notices.ts';

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

describe('W-O2: /account', () => {
  it('linked exige provider y es una confirmación', () => {
    expect(urlMessage('account', new URLSearchParams('notice=linked&provider=facebook'))).toEqual({
      kind: 'success',
      text: 'Hemos unido Facebook a tu cuenta. Ya puedes entrar con cualquiera de tus formas de entrar.',
    });
    expect(urlMessage('account', new URLSearchParams('notice=linked'))).toBeNull();
    // Los avisos de /login no valen en /account.
    expect(urlMessage('account', new URLSearchParams('notice=signup-cancelled'))).toBeNull();
  });
});

describe('W-O2: /account, /account/password y /account/delete (técnico §11.4)', () => {
  const at = (page: 'account' | 'account-step', query: string) =>
    urlMessage(page, new URLSearchParams(query));

  it('unlinked exige provider; password-created y reauthenticated son confirmaciones', () => {
    expect(at('account', 'notice=unlinked&provider=google')).toEqual({
      kind: 'success',
      text: 'Hemos quitado Google. Ya no puedes entrar con él.',
    });
    expect(at('account', 'notice=unlinked')).toBeNull();
    expect(at('account', 'notice=password-created')?.kind).toBe('success');
    expect(at('account-step', 'notice=reauthenticated')?.kind).toBe('success');
  });

  it('reauth-required ya no existe (decisión 21)', () => {
    expect(at('account-step', 'error=reauth-required')).toBeNull();
    expect(at('account', 'error=reauth-required')).toBeNull();
  });

  it('/account resuelve email-missing, email-unverified, connect-refused y confirm-expired (decisión 21)', () => {
    expect(at('account', 'error=email-missing&provider=facebook')).toMatchObject({
      kind: 'error',
      text: expect.stringMatching(/^Facebook no nos ha enviado tu correo/),
    });
    expect(at('account', 'error=email-unverified&provider=google')).toMatchObject({
      kind: 'error',
      text: expect.stringMatching(/^El correo de tu cuenta de Google todavía no está verificado/),
    });
    expect(at('account', 'error=connect-refused&provider=google')).toEqual({
      kind: 'error',
      text: 'No hemos podido unir esta cuenta de Google a la tuya. No hemos hecho ningún cambio. Prueba con otra cuenta de Google o sigue entrando como hasta ahora.',
    });
    expect(at('account', 'error=confirm-expired&provider=facebook')?.text).toMatch(
      /Vuelve a confirmar con Facebook\.$/,
    );
    // Todos llevan {proveedor}: sin él no se muestra nada.
    expect(at('account', 'error=connect-refused')).toBeNull();
  });

  it('cada página solo acepta su lista', () => {
    expect(at('account-step', 'error=last-method&provider=google')).toBeNull();
    expect(at('account-step', 'notice=password-created')).toBeNull();
    expect(at('account-step', 'error=email-missing&provider=google')).toBeNull();
    expect(at('account', 'error=link-limit')).toBeNull();
    expect(at('account', 'error=last-method&provider=facebook')?.text).toBe(
      'No hemos quitado Facebook porque es la única forma que tienes de entrar.',
    );
  });
});

describe('W-O2: errores de contraseña en /account (decisión 20)', () => {
  it('password-required y password-incorrect solo en /account', () => {
    const at = (page: 'account' | 'account-step', query: string) =>
      urlMessage(page, new URLSearchParams(query));
    expect(at('account', 'error=password-incorrect')).toEqual({
      kind: 'error',
      text: 'La contraseña no es correcta. No hemos hecho ningún cambio.',
    });
    expect(at('account', 'error=password-required')?.kind).toBe('error');
    expect(at('account-step', 'error=password-incorrect')).toBeNull();
  });
});

describe('W-O2: valores que coinciden con propiedades heredadas (CodeRabbit)', () => {
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    '«%s» en error o notice no muestra nada y no lanza',
    (value) => {
      for (const page of ['entry', 'account', 'account-step'] as const) {
        expect(urlMessage(page, new URLSearchParams(`error=${value}&provider=google`))).toBeNull();
        expect(urlMessage(page, new URLSearchParams(`notice=${value}&provider=google`))).toBeNull();
      }
    },
  );
});

describe('/account sin contraseña: el resultado de añadir va al panel (decisión 21)', () => {
  const signIn = (overrides: Partial<SignInMethodsView> = {}): SignInMethodsView => ({
    hasPassword: false,
    linked: [{ provider: 'facebook', linkedOn: null, lastUsedOn: null }],
    addable: ['google'],
    methods: 1,
    confirmWith: 'facebook',
    ...overrides,
  });
  const at = (query: string, view = signIn()) => connectMessages(view, new URLSearchParams(query));

  it('un error del proveedor nuevo o del que confirma abre el panel del que se añade', () => {
    expect(at('error=connect-refused&provider=google')).toEqual({
      message: null,
      connect: {
        provider: 'google',
        message: {
          kind: 'error',
          text: 'No hemos podido unir esta cuenta de Google a la tuya. No hemos hecho ningún cambio. Prueba con otra cuenta de Google o sigue entrando como hasta ahora.',
        },
      },
    });
    expect(at('error=identity-mismatch&provider=facebook').connect?.provider).toBe('google');
    expect(at('notice=provider-cancelled&provider=facebook').connect?.message.kind).toBe('notice');
  });

  it('«caducada» nombra al proveedor que confirma, aunque la URL traiga el nuevo', () => {
    expect(at('error=confirm-expired&provider=google').connect?.message.text).toMatch(
      /Vuelve a confirmar con Facebook\.$/,
    );
  });

  it('el éxito usa cuenta.confirmar.exito con el proveedor añadido, arriba', () => {
    expect(at('notice=linked&provider=google', signIn({ addable: [] }))).toEqual({
      message: {
        kind: 'success',
        text: 'Hemos añadido Google. Ya puedes entrar con cualquiera de tus formas de entrar.',
      },
      connect: null,
    });
  });

  it('con contraseña, o con un aviso que no es de añadir, todo va arriba como siempre', () => {
    expect(
      at('error=connect-refused&provider=google', signIn({ hasPassword: true })),
    ).toMatchObject({ message: { kind: 'error' }, connect: null });
    expect(at('notice=linked&provider=google', signIn({ hasPassword: true })).message?.text).toBe(
      'Hemos unido Google a tu cuenta. Ya puedes entrar con cualquiera de tus formas de entrar.',
    );
    expect(at('error=last-method&provider=facebook')).toMatchObject({
      message: { kind: 'error' },
      connect: null,
    });
    expect(at('')).toEqual({ message: null, connect: null });
  });
});

describe('avisos del correo (correo UX §6.10)', () => {
  const params = (query: string) => new URLSearchParams(query);

  it('B7-6: /account?notice=cualquier-cosa no muestra nada', () => {
    expect(urlMessage('account', params('notice=cualquier-cosa'))).toBeNull();
    expect(urlMessage('check-email-signup', params('notice=cualquier-cosa'))).toBeNull();
  });

  it('los avisos de confirmar son confirmaciones; el reenvío lleva el correo', () => {
    expect(urlMessage('account', params('notice=email-verified-signin'))).toEqual({
      kind: 'success',
      text: 'Hemos confirmado tu correo y has entrado en tu cuenta.',
    });
    expect(
      urlMessage('account', params('notice=verification-sent'), { correo: 'beto@example.com' }),
    ).toEqual({
      kind: 'success',
      text: 'Te hemos enviado otro mensaje a beto@example.com. El enlace anterior ya no funciona.',
    });
    // Sin el correo no se pinta un «{correo}» suelto.
    expect(urlMessage('account', params('notice=verification-sent'))).toBeNull();
  });

  it('email-not-verified exige provider', () => {
    expect(urlMessage('account', params('error=email-not-verified'))).toBeNull();
    expect(urlMessage('account', params('error=email-not-verified&provider=google'))).toEqual({
      kind: 'error',
      text: 'No hemos añadido Google porque tu correo aún no está confirmado. Confírmalo e inténtalo de nuevo. No hemos hecho ningún cambio.',
    });
  });

  it('«Revisa tu correo»: reenviado, límite y fallo', () => {
    expect(
      urlMessage('check-email-signup', params('notice=resent'), { correo: 'a@example.com' })?.text,
    ).toBe(
      'Si hay una cuenta con a@example.com, te hemos enviado otro mensaje. El enlace anterior ya no funciona.',
    );
    expect(urlMessage('check-email-signup', params('error=rate-limited'))?.kind).toBe('error');
    expect(urlMessage('check-email-signup', params('error=resend-failed'))?.kind).toBe('error');
  });
});
