import type { WebErrorCode } from '#lib/errors/messages.ts';
import { fill, t, type TextKey } from '#lib/texts.ts';
import { textField } from './form-data.ts';

/**
 * Campo oculto con los `CAPTCHA_INVALID` seguidos de este formulario (UX de captcha §3.6). Se
 * cuenta en el cliente, no en el servidor: solo sirve para cambiar el texto y no entrar en bucle.
 */
export const CAPTCHA_FAILURES_FIELD = 'captchaFailures';
const MAX_COUNTED = 10;

export interface CaptchaFailure {
  key: TextKey;
  failures: number;
}

/** Contador que el formulario devuelto lleva en su campo oculto. */
export const captchaFailuresFrom = (data: FormData): number =>
  Math.min(
    MAX_COUNTED,
    Math.max(0, Number.parseInt(textField(data, CAPTCHA_FAILURES_FIELD), 10) || 0),
  );

/** Texto y contador tras un `CAPTCHA_REQUIRED` o `CAPTCHA_INVALID` de la API. */
export function captchaFailure(
  code: Extract<WebErrorCode, 'CAPTCHA_REQUIRED' | 'CAPTCHA_INVALID'>,
  data: FormData,
): CaptchaFailure {
  const previous = captchaFailuresFrom(data);
  if (code === 'CAPTCHA_REQUIRED') return { key: 'captcha.error.requerido', failures: previous };
  const failures = Math.min(MAX_COUNTED, previous + 1);
  return {
    key: failures >= 2 ? 'captcha.error.invalido_repetido' : 'captcha.error.invalido',
    failures,
  };
}

/**
 * Texto del error de la comprobación, con la frase de soporte al final si se conoce la dirección y
 * el error es `requerido` o `invalido_repetido` (UX de captcha §5.2).
 */
export function captchaErrorText(key: TextKey, supportEmail: string | null): string {
  const withSupport =
    supportEmail !== null &&
    (key === 'captcha.error.requerido' || key === 'captcha.error.invalido_repetido');
  return withSupport
    ? `${t(key)} ${fill('captcha.frase.soporte', { soporte: supportEmail })}`
    : t(key);
}
