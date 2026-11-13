import type { SubmitFunction } from '$app/forms';
import { tick } from 'svelte';

/**
 * Mejora de `use:enhance` común a los formularios: estado «enviando», se ignoran los envíos
 * repetidos y, tras una respuesta con errores, el foco pasa al resumen (UX §2.2).
 */
export function createSubmission() {
  let sending = $state(false);

  const submit: SubmitFunction = ({ cancel }) => {
    if (sending) {
      cancel();
      return;
    }
    sending = true;
    return async ({ result, update }) => {
      try {
        await update();
      } finally {
        sending = false;
      }
      if (result.type === 'failure') {
        await tick();
        // El resumen de errores o el título de la pantalla de menor llevan este atributo.
        document.querySelector<HTMLElement>('[data-foco-resultado]')?.focus();
      }
    };
  };

  return {
    get sending() {
      return sending;
    },
    submit,
  };
}
