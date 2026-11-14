import { OAUTH_PROVIDERS, type AccountResponse, type OAuthProvider } from '@cupidilla/contracts';

const TIME_ZONE = 'Europe/Madrid';

/** Día, en hora de Madrid: «11 de noviembre de 2026». */
const dayFormat = new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeZone: TIME_ZONE });
/** Día y hora, en hora de Madrid: «11 de noviembre de 2026 a las 11:00». */
const dateTimeFormat = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: TIME_ZONE,
});
/**
 * Fecha sin hora (`AAAA-MM-DD`): se lee como medianoche UTC y se formatea en UTC, así no cambia
 * de día con la zona horaria del servidor.
 */
const plainDateFormat = new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeZone: 'UTC' });

/** Fecha lista para pintar: el texto y el valor ISO para `<time datetime>`. */
export interface FormattedDate {
  iso: string;
  text: string;
}

function format(formatter: Intl.DateTimeFormat, value: string): FormattedDate | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return { iso: value, text: formatter.format(date) };
}

/** Día de un instante (alta, condiciones, unión), en hora de Madrid. `null` si no es válido. */
export const formatDay = (value: string): FormattedDate | null => format(dayFormat, value);

/** Día y hora de un instante, en hora de Madrid. `null` si no es válido. */
export const formatDateTime = (value: string): FormattedDate | null =>
  format(dateTimeFormat, value);

/** Fecha sin hora (nacimiento), sin desfase de zona horaria. `null` si no es válida. */
export function formatPlainDate(value: string): FormattedDate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const formatted = format(plainDateFormat, `${value}T00:00:00.000Z`);
  return formatted && { iso: value, text: formatted.text };
}

/** «Tus datos» en /account (UX §3.5). Una fecha que no se puede leer no se pinta. */
export interface AccountDetailsView {
  email: string;
  birthDate: FormattedDate | null;
  createdOn: FormattedDate | null;
  /** Última vez que se demostró la identidad en esta sesión. */
  sessionSince: FormattedDate | null;
  terms: { version: string; acceptedOn: string } | null;
}

export function accountDetailsView(account: AccountResponse): AccountDetailsView {
  const consent = account.consents.find(
    (item) => item.purpose === 'service_use' && item.revokedAt === null,
  );
  const acceptedOn = consent ? formatDay(consent.grantedAt) : null;
  return {
    email: account.user.email,
    birthDate: formatPlainDate(account.user.birthDate),
    createdOn: formatDay(account.user.createdAt),
    sessionSince: formatDateTime(account.session.authenticatedAt),
    terms:
      consent && acceptedOn
        ? { version: consent.policyVersion, acceptedOn: acceptedOn.text }
        : null,
  };
}

/** Una sesión abierta, en el orden de la API (la actual primero). */
export interface OpenSessionView {
  /** Número para «Sesión {n}», desde 1. */
  n: number;
  current: boolean;
  createdAt: FormattedDate | null;
  authenticatedAt: FormattedDate | null;
  expiresAt: FormattedDate | null;
}

/** «Sesiones abiertas» en /account. La web no reordena: el orden lo marca la API. */
export function openSessionsView(account: AccountResponse): OpenSessionView[] {
  return account.sessions.map((item, index) => ({
    n: index + 1,
    current: item.current,
    createdAt: formatDateTime(item.createdAt),
    authenticatedAt: formatDateTime(item.authenticatedAt),
    expiresAt: formatDateTime(item.expiresAt),
  }));
}

/** Lo que necesitan las páginas privadas sobre las formas de entrar (UX §3.5). */
export interface SignInMethodsView {
  hasPassword: boolean;
  /**
   * Proveedores unidos, con las fechas ya formateadas, en el orden de la interfaz. Una fecha es
   * `null` si no se puede leer: entonces no se pinta.
   */
  linked: { provider: OAuthProvider; linkedOn: string | null; lastUsedOn: string | null }[];
  /** Proveedores configurados que todavía no están unidos. */
  addable: OAuthProvider[];
  /** Formas de entrar en total: si es 1, no se puede quitar la que queda. */
  methods: number;
  /**
   * Proveedor unido con el que se confirma una acción en una cuenta sin contraseña (decisión 21):
   * el usado más recientemente, el mismo que elige la API. `null` si no hay ninguno unido.
   */
  confirmWith: OAuthProvider | null;
}

export function signInMethodsView(
  account: AccountResponse,
  configured: readonly OAuthProvider[],
): SignInMethodsView {
  const { password, identities } = account.signInMethods;
  const linked = OAUTH_PROVIDERS.flatMap((provider) => {
    const identity = identities.find((item) => item.provider === provider);
    if (!identity) return [];
    return [
      {
        provider,
        linkedOn: formatDay(identity.linkedAt)?.text ?? null,
        lastUsedOn: formatDateTime(identity.lastUsedAt)?.text ?? null,
      },
    ];
  });
  const [lastUsed] = [...identities].sort(
    (a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime(),
  );
  return {
    hasPassword: password,
    linked,
    addable: configured.filter((provider) => !linked.some((item) => item.provider === provider)),
    methods: linked.length + (password ? 1 : 0),
    confirmWith: lastUsed?.provider ?? null,
  };
}
