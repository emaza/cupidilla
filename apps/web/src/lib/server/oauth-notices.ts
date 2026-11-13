import { OAUTH_PROVIDERS, type OAuthProvider } from '@cupidilla/contracts';
import { fill, texts, type TextKey } from '#lib/texts.ts';

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
  /** `notice`: informativo, sin «Error:» (cancelar no es un error). `error`: patrón de H0 §2.2. */
  kind: 'notice' | 'error';
  text: string;
}

/** Páginas con listas cerradas de avisos (técnico §11.4). */
export type MessagePage = 'entry';

interface Entry {
  key: TextKey;
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
  };

function resolve(entry: Entry | undefined, provider: string | null): string | null {
  if (!entry) return null;
  const text = texts[entry.key];
  const usesProvider = text.includes('{proveedor}');
  // Sin un proveedor válido no se muestra nada: ni el aviso que lo exige ni un «{proveedor}» suelto.
  if ((entry.needsProvider || usesProvider) && !isProvider(provider)) return null;
  return usesProvider && isProvider(provider)
    ? fill(entry.key, { proveedor: PROVIDER_NAMES[provider] })
    : text;
}

/**
 * Aviso o error de la URL para esa página. Un valor fuera de la lista, o un `provider` ausente
 * o inválido donde hace falta, no muestra nada (acuerdo A7 de H0). El error gana al aviso.
 */
export function urlMessage(page: MessagePage, params: URLSearchParams): UrlMessage | null {
  const list = LISTS[page];
  const provider = params.get('provider');
  const errorValue = params.get('error');
  const errorText = errorValue === null ? null : resolve(list.error[errorValue], provider);
  if (errorText) return { kind: 'error', text: errorText };
  const noticeValue = params.get('notice');
  const noticeText = noticeValue === null ? null : resolve(list.notice[noticeValue], provider);
  return noticeText ? { kind: 'notice', text: noticeText } : null;
}
