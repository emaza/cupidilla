import type { SubmitFunction } from '$app/forms';
import { tick } from 'svelte';
import type { Captcha } from '#lib/captcha/captcha.svelte.ts';

/**
 * Mejora de `use:enhance` común a los formularios: estado «enviando», se ignoran los envíos
 * repetidos y, tras una respuesta con errores, el foco pasa al resumen (UX §2.2).
 *
 * Con `captcha` (técnico de captcha §6, paso 4; UX de captcha §3.4): si se envía antes de que la
 * comprobación termine, se retiene el envío, se espera (como mucho 20 s) y se vuelve a enviar una
 * sola vez con los valores de ese momento. Si falla, el foco va a la casilla del widget.
 */
export function createSubmission({
  navigateOnFailure = true,
  captcha,
}: {
  /**
   * Tras un fallo, SvelteKit navega a la URL de la acción si no es la actual (p. ej. sin
   * `?notice=`), y eso vuelve a cargar la página. Con `false`, se queda y solo pinta el resultado:
   * hace falta cuando la acción ha cerrado la sesión (menor en /account/review).
   */
  navigateOnFailure?: boolean;
  captcha?: Captcha;
} = {}) {
  let sending = $state(false);
  /** Esperando a la comprobación antibots para enviar. */
  let checking = $state(false);
  /** El reenvío automático tras la comprobación: no es un clic repetido. */
  let resubmitting = false;

  const submit: SubmitFunction = ({ cancel, formElement, submitter }) => {
    if (sending && !resubmitting) {
      cancel();
      return;
    }
    resubmitting = false;
    if (captcha?.active && !captcha.ready) {
      cancel();
      sending = true;
      checking = true;
      void captcha.ensureVerified().then(async (ok) => {
        if (ok) {
          // `sending` y `checking` siguen hasta la respuesta: el botón y la región de estado no
          // cambian, y «Comprobando y enviando…» se anuncia una sola vez (UX §3.4).
          await tick();
          resubmitting = true;
          formElement.requestSubmit(submitter instanceof HTMLElement ? submitter : null);
        } else {
          sending = false;
          checking = false;
          captcha.checkbox()?.focus();
        }
      });
      return;
    }
    sending = true;
    return async ({ result, update }) => {
      try {
        await update({ navigate: navigateOnFailure || result.type !== 'failure' });
      } finally {
        sending = false;
        checking = false;
      }
      if (result.type === 'failure') {
        await tick();
        // El resumen de errores o el título de la pantalla de menor llevan este atributo.
        document.querySelector<HTMLElement>('[data-result-focus]')?.focus();
      }
    };
  };

  return {
    get sending() {
      return sending;
    },
    get checking() {
      return checking;
    },
    submit,
  };
}
