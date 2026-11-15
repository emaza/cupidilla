import { formatSpanishDate, type OAuthProvider } from '@cupidilla/contracts';
import { renderMail, type MailContext, type RenderedMail } from './layout.js';

/**
 * Variante del aviso «Alguien ha intentado registrarse con tu correo» (UX §5.3, correo §4.3),
 * elegida al enviar:
 * - `verified`: (a) cuenta con el correo confirmado, tenga o no contraseña.
 * - `unverified`: (b) cuenta sin confirmar, con su fecha de borrado.
 * - `provider`: (c) correo de un proveedor unido a una cuenta con otro correo.
 */
export type SignupNoticeInput =
  | { variant: 'verified'; email: string }
  | { variant: 'unverified'; email: string; deletionAt: Date }
  | { variant: 'provider'; email: string; providers: OAuthProvider[] };

const SUBJECT = 'Alguien ha intentado registrarse con tu correo';
const PROVIDER_NAMES: Record<OAuthProvider, string> = { google: 'Google', facebook: 'Facebook' };

/** «Google», «Facebook» o «Google y Facebook», en el orden recibido. */
export function providerList(providers: OAuthProvider[]): string {
  const names = providers.map((provider) => PROVIDER_NAMES[provider]);
  return names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

export function renderSignupNotice(context: MailContext, input: SignupNoticeInput): RenderedMail {
  const login = `${context.webUrl}/login`;
  const forgot = `${context.webUrl}/forgot-password`;
  const attempt = `Alguien ha intentado crear una cuenta de Cupidilla con este correo (${input.email}).`;

  switch (input.variant) {
    case 'verified':
      return renderMail(context, {
        subject: SUBJECT,
        heading: 'Ya tienes una cuenta en Cupidilla',
        blocks: [
          {
            type: 'p',
            text: `Alguien ha intentado crear una cuenta de Cupidilla con este correo (${input.email}), pero ya hay una. No hemos cambiado nada.`,
          },
          {
            type: 'p',
            text: 'Si has sido tú y no te acordabas de que ya tenías cuenta, entra aquí:',
          },
          { type: 'action', label: 'Entrar en mi cuenta', url: login },
          { type: 'p', text: 'Si no recuerdas la contraseña, puedes crear una nueva aquí:' },
          { type: 'action', label: 'Recuperar mi contraseña', url: forgot, secondary: true },
          {
            type: 'strong',
            text: `Si no has sido tú, no tienes que hacer nada: tu cuenta y tu contraseña siguen como estaban. Si temes que otra persona conozca tu contraseña, créate una nueva con el segundo enlace: así cerraremos todas las sesiones abiertas de tu cuenta. Si tienes dudas, escribe a ${context.supportAddress}.`,
          },
        ],
      });
    case 'unverified':
      return renderMail(context, {
        subject: SUBJECT,
        heading: 'Hay una cuenta sin confirmar con tu correo',
        blocks: [
          {
            type: 'p',
            text: `${attempt} Ya hay una cuenta con él, pero todavía no se ha confirmado. No hemos cambiado nada.`,
          },
          {
            type: 'p',
            text: 'Si la creaste tú y no recuerdas haberla confirmado, entra y confírmala desde Tu cuenta (te enviaremos un enlace):',
          },
          { type: 'action', label: 'Entrar', url: login, secondary: true },
          {
            type: 'p',
            text: 'Si no la creaste tú, es posible que otra persona haya usado tu correo. Para quedarte con él, crea una contraseña nueva aquí:',
          },
          { type: 'action', label: 'Quedarme con mi correo', url: forgot },
          {
            type: 'p',
            text: 'Al entrar con la contraseña nueva te pediremos que escribas tu fecha de nacimiento y que aceptes las condiciones de uso.',
          },
          {
            type: 'strong',
            text: `Si no haces nada, la cuenta sin confirmar se borrará el ${formatSpanishDate(input.deletionAt)} y tu correo quedará libre. Si tienes dudas, escribe a ${context.supportAddress}.`,
          },
        ],
      });
    case 'provider': {
      const providers = providerList(input.providers);
      return renderMail(context, {
        subject: SUBJECT,
        heading: 'Tu correo ya está unido a una cuenta',
        blocks: [
          {
            type: 'p',
            text: `${attempt} Este correo ya está unido a una cuenta de Cupidilla a través de ${providers}, aunque esa cuenta usa otro correo. No hemos cambiado nada.`,
          },
          {
            type: 'p',
            text: `Si has sido tú y no te acordabas de que ya tenías cuenta, entra con ${providers}:`,
          },
          { type: 'action', label: 'Entrar en mi cuenta', url: login },
          {
            type: 'strong',
            text: `Si no has sido tú, no tienes que hacer nada: tu cuenta sigue como estaba. Si no puedes entrar o tienes dudas, escribe a ${context.supportAddress}.`,
          },
        ],
      });
    }
  }
}
