import {
  OAUTH_PROVIDERS,
  RECENT_AUTH_MAX_AGE_MINUTES,
  type AccountResponse,
  type OAuthProvider,
} from '@cupidilla/contracts';
import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { passwordInputSchema } from '@cupidilla/contracts';
import { textField } from '#lib/forms/form-data.ts';
import type { TextKey } from '#lib/texts.ts';
import { api } from './api-client.ts';
import type { ReturnPath } from './return-path.ts';

const linkedOn = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Madrid',
});

/** Lo que necesitan las páginas privadas sobre las formas de entrar (UX §3.5). */
export interface SignInMethodsView {
  hasPassword: boolean;
  /** Proveedores unidos, con la fecha ya formateada, en el orden de la interfaz. */
  linked: { provider: OAuthProvider; linkedOn: string }[];
  /** Proveedores configurados que todavía no están unidos. */
  addable: OAuthProvider[];
  /** Formas de entrar en total: si es 1, no se puede quitar la que queda. */
  methods: number;
  /**
   * La web decide con esto qué pintar; la API lo vuelve a comprobar siempre (técnico §10.2).
   */
  recent: boolean;
}

export function signInMethodsView(
  account: AccountResponse,
  configured: readonly OAuthProvider[],
  now = new Date(),
): SignInMethodsView {
  const { password, identities } = account.signInMethods;
  const linked = OAUTH_PROVIDERS.flatMap((provider) => {
    const identity = identities.find((item) => item.provider === provider);
    return identity ? [{ provider, linkedOn: linkedOn.format(new Date(identity.linkedAt)) }] : [];
  });
  const age = now.getTime() - new Date(account.session.authenticatedAt).getTime();
  return {
    hasPassword: password,
    linked,
    addable: configured.filter((provider) => !linked.some((item) => item.provider === provider)),
    methods: linked.length + (password ? 1 : 0),
    recent: age < RECENT_AUTH_MAX_AGE_MINUTES * 60_000,
  };
}

/** Errores de la confirmación con contraseña: en el campo o generales. */
export interface ReauthenticateErrors {
  password?: TextKey;
  general?: TextKey;
}

/**
 * Acción `reauthenticate` de las páginas privadas: confirmar con la contraseña (UX §3.5.2,
 * técnico T16). Si acierta, vuelve a la misma página con `?notice=reauthenticated`.
 */
export async function reauthenticateWithPassword(event: RequestEvent, page: ReturnPath) {
  const password = textField(await event.request.formData(), 'password');
  const token = event.locals.sessionToken;
  if (!token) redirect(303, `/login?next=${page}`);
  const failure = (status: number, errors: ReauthenticateErrors) =>
    fail(status, { reauthenticate: errors });
  const fieldError = (key: TextKey, status = 400) => failure(status, { password: key });
  if (!passwordInputSchema.safeParse(password).success) {
    return fieldError(
      password === '' ? 'verificar.error.contrasena_vacia' : 'verificar.error.contrasena',
    );
  }
  const result = await api.reauthenticate(event, token, { password });
  if (result.ok) redirect(303, `${page}?notice=reauthenticated`);
  if (result.status === 401) redirect(303, `/login?next=${page}`);
  if (result.status === 429) redirect(303, `${page}?error=rate-limited`);
  if (result.error.code === 'PASSWORD_INCORRECT') {
    return fieldError('verificar.error.contrasena', 403);
  }
  // No hay texto propio en UX: el general de «algo ha fallado».
  return failure(result.status, { general: 'error500.texto' });
}
