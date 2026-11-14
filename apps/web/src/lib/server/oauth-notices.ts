import { OAUTH_PROVIDERS, type OAuthProvider } from '@cupidilla/contracts';
import { fill, texts, type TextKey } from '#lib/texts.ts';
import type { SignInMethodsView } from './account-view.ts';

/** Nombre del proveedor tal como aparece en los textos. */
export const PROVIDER_NAMES: Record<OAuthProvider, string> = {
  google: 'Google',
  facebook: 'Facebook',
};

export function isProvider(value: unknown): value is OAuthProvider {
  return typeof value === 'string' && (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/** Aviso o error que llega en la URL, ya resuelto a texto. */
export interface UrlMessage {
  /**
   * `notice`: informativo, sin «Error:» (cancelar no es un error). `success`: confirmación.
   * `error`: patrón de H0 §2.2.
   */
  kind: 'notice' | 'success' | 'error';
  text: string;
}

/** Páginas con listas cerradas de avisos (técnico §11.4). */
export type MessagePage = 'entry' | 'account' | 'account-step';

interface Entry {
  key: TextKey;
  /** Confirmación de algo hecho (✓), no un simple aviso. */
  success?: boolean;
  /** El valor exige `&provider=` válido (marcado con * en §11.4). */
  needsProvider?: boolean;
}

const LISTS: Record<MessagePage, { notice: Record<string, Entry>; error: Record<string, Entry> }> =
  {
    // /login y /register
    entry: {
      notice: {
        'provider-cancelled': { key: 'proveedor.aviso.cancelado' },
        'signup-cancelled': { key: 'alta.aviso.cancelada' },
        'link-cancelled': { key: 'union.aviso.cancelada' },
      },
      error: {
        'provider-failed': { key: 'proveedor.error.fallo' },
        'provider-expired': { key: 'proveedor.error.caducado' },
        'email-missing': { key: 'proveedor.error.sin_correo' },
        'email-unverified': { key: 'proveedor.error.correo_sin_verificar' },
        'other-provider': { key: 'proveedor.error.cuenta_con_otro', needsProvider: true },
        'link-limit': { key: 'union.error.limite' },
        'rate-limited': { key: 'comun.error.limite' },
      },
    },
    // /account
    account: {
      notice: {
        linked: { key: 'cuenta.aviso.unida', needsProvider: true, success: true },
        unlinked: { key: 'cuenta.aviso.quitada', needsProvider: true, success: true },
        'password-created': { key: 'contrasena.aviso.creada', success: true },
        reauthenticated: { key: 'verificar.aviso.confirmada', success: true },
        'provider-cancelled': { key: 'verificar.aviso.cancelado' },
      },
      error: {
        'provider-failed': { key: 'cuenta.error.proveedor_fallo' },
        'identity-in-use': { key: 'cuenta.error.proveedor_en_uso' },
        'already-linked': { key: 'cuenta.error.ya_unido' },
        'identity-mismatch': { key: 'verificar.error.otra_cuenta' },
        'email-missing': { key: 'cuenta.error.sin_correo' },
        'email-unverified': { key: 'cuenta.error.correo_sin_verificar' },
        'connect-refused': { key: 'cuenta.error.union_rechazada' },
        // Con sesión, cualquier flujo caducado vuelve aquí (decisión 21). El proveedor del texto
        // es el que confirma: lo pone la página.
        'confirm-expired': { key: 'cuenta.confirmar.error.caducada' },
        'last-method': { key: 'cuenta.error.ultima_forma' },
        'password-required': { key: 'cuenta.error.contrasena_vacia' },
        'password-incorrect': { key: 'cuenta.error.contrasena' },
        'rate-limited': { key: 'comun.error.limite' },
      },
    },
    // /account/password y /account/delete
    'account-step': {
      notice: {
        reauthenticated: { key: 'verificar.aviso.confirmada', success: true },
        'provider-cancelled': { key: 'verificar.aviso.cancelado' },
        linked: { key: 'cuenta.aviso.unida', needsProvider: true, success: true },
      },
      error: {
        'provider-failed': { key: 'cuenta.error.proveedor_fallo' },
        'identity-mismatch': { key: 'verificar.error.otra_cuenta' },
        'rate-limited': { key: 'comun.error.limite' },
      },
    },
  };

/**
 * Entrada de la lista para un valor de la URL. Solo propiedades propias: `constructor`,
 * `toString` o `__proto__` no son avisos y no deben llegar a `resolve`.
 */
function ownEntry(list: Record<string, Entry>, value: string | null): Entry | undefined {
  return value !== null && Object.hasOwn(list, value) ? list[value] : undefined;
}

function resolve(entry: Entry | undefined, provider: string | null): string | null {
  if (!entry) return null;
  const text = texts[entry.key];
  const usesProvider = text.includes('{proveedor}');
  // Sin un proveedor válido no se muestra nada: ni el aviso que lo exige ni un «{proveedor}» suelto.
  if ((entry.needsProvider || usesProvider) && !isProvider(provider)) return null;
  return fill(entry.key, { proveedor: isProvider(provider) ? PROVIDER_NAMES[provider] : '' });
}

/**
 * Aviso o error de la URL para esa página. Un valor fuera de la lista, o un `provider` ausente
 * o inválido donde hace falta, no muestra nada (acuerdo A7 de H0). El error gana al aviso.
 */
export function urlMessage(page: MessagePage, params: URLSearchParams): UrlMessage | null {
  const list = LISTS[page];
  const provider = params.get('provider');
  const errorValue = params.get('error');
  const errorText = resolve(ownEntry(list.error, errorValue), provider);
  if (errorText) return { kind: 'error', text: errorText };
  const noticeValue = params.get('notice');
  const notice = ownEntry(list.notice, noticeValue);
  const noticeText = resolve(notice, provider);
  if (!noticeText) return null;
  return { kind: notice?.success ? 'success' : 'notice', text: noticeText };
}

/** Valores de la URL que vienen del flujo de añadir un proveedor (decisión 21). */
const CONNECT_FLOW_VALUES = {
  notice: ['provider-cancelled'],
  error: [
    'provider-failed',
    'identity-mismatch',
    'identity-in-use',
    'already-linked',
    'email-missing',
    'email-unverified',
    'connect-refused',
    'confirm-expired',
  ],
};

/**
 * Avisos de /account. En una cuenta sin contraseña, el resultado del flujo de añadir un proveedor
 * va dentro del panel de confirmación de ese proveedor (`connect`), no arriba (UX decisión 21):
 * - «caducada» nombra al proveedor que confirma, no al de la vuelta;
 * - el éxito lleva su propio texto, con el proveedor añadido.
 */
export function connectMessages(
  signIn: SignInMethodsView,
  params: URLSearchParams,
): {
  message: UrlMessage | null;
  connect: { provider: OAuthProvider; message: UrlMessage } | null;
} {
  const confirmWith = signIn.hasPassword ? null : signIn.confirmWith;
  const provider = params.get('provider');
  const errorValue = params.get('error');
  const noticeValue = params.get('notice');
  if (!confirmWith) return { message: urlMessage('account', params), connect: null };

  if (errorValue === null && noticeValue === 'linked' && isProvider(provider)) {
    return {
      message: {
        kind: 'success',
        text: fill('cuenta.confirmar.exito', { proveedorNuevo: PROVIDER_NAMES[provider] }),
      },
      connect: null,
    };
  }

  const resolved = new URLSearchParams(params);
  if (errorValue === 'confirm-expired') resolved.set('provider', confirmWith);
  const message = urlMessage('account', resolved);
  const fromConnect =
    errorValue !== null
      ? CONNECT_FLOW_VALUES.error.includes(errorValue)
      : noticeValue !== null && CONNECT_FLOW_VALUES.notice.includes(noticeValue);
  const [first] = signIn.addable;
  if (!message || !fromConnect || !first) return { message, connect: null };
  const target = isProvider(provider) && signIn.addable.includes(provider) ? provider : first;
  return { message: null, connect: { provider: target, message } };
}
