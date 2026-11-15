import type { SubmitFunction } from '$app/forms';
import { tick } from 'svelte';

/**
 * Mejora de `use:enhance` común a los formularios: estado «enviando», se ignoran los envíos
 * repetidos y, tras una respuesta con errores, el foco pasa al resumen (UX §2.2).
 */
export function createSubmission({
  navigateOnFailure = true,
}: {
  /**
   * Tras un fallo, SvelteKit navega a la URL de la acción si no es la actual (p. ej. sin
   * `?notice=`), y eso vuelve a cargar la página. Con `false`, se queda y solo pinta el resultado:
   * hace falta cuando la acción ha cerrado la sesión (menor en /account/review).
   */
  navigateOnFailure?: boolean;
} = {}) {
  let sending = $state(false);

  const submit: SubmitFunction = ({ cancel }) => {
    if (sending) {
      cancel();
      return;
    }
    sending = true;
    return async ({ result, update }) => {
      try {
        await update({ navigate: navigateOnFailure || result.type !== 'failure' });
      } finally {
        sending = false;
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
    submit,
  };
}
