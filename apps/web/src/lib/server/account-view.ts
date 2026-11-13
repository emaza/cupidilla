import {
  OAUTH_PROVIDERS,
  RECENT_AUTH_MAX_AGE_MINUTES,
  type AccountResponse,
  type OAuthProvider,
} from '@cupidilla/contracts';

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
