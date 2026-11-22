<script lang="ts">
  import { CONTACT_MESSAGE_MAX, contactTextLength } from '@cupidilla/contracts';
  import { fill, t } from '#lib/texts.ts';
  import FieldError from './FieldError.svelte';

  /**
   * Mensaje del formulario de contacto con su contador (contacto UX §2.1.1). El contador solo
   * existe con JavaScript, cuenta con la misma regla que el servidor y no impide escribir ni pegar:
   * sin `maxlength`. El lector de pantalla solo oye un aviso al cruzar el 90 % y al pasarse, un
   * segundo después de dejar de escribir.
   */
  // El valor inicial va como contenido: Svelte no pinta `defaultValue` de un <textarea> en el
  // servidor, y sin JavaScript se perdería el mensaje tras un error (UX §2.1.4).
  let { value, error }: { value: string; error?: string } = $props();

  const max = CONTACT_MESSAGE_MAX;
  const ANNOUNCE_DELAY_MS = 1000;

  let textarea: HTMLTextAreaElement | undefined = $state();
  let mounted = $state(false);
  let length = $state(0);
  let announcement = $state('');
  let announced: 'ok' | 'near' | 'over' = 'ok';
  let timer: ReturnType<typeof setTimeout> | undefined;

  const over = $derived(length > max);
  const counterText = $derived(
    over
      ? fill('contacto.contador.exceso', {
          n: String(length),
          max: String(max),
          sobran: String(length - max),
        })
      : fill('contacto.contador', { n: String(length), max: String(max) }),
  );
  const describedBy = $derived(
    ['message-help', error ? 'message-error' : '', mounted ? 'message-counter' : '']
      .filter(Boolean)
      .join(' '),
  );

  const levelOf = (n: number): typeof announced =>
    n > max ? 'over' : n >= max * 0.9 ? 'near' : 'ok';

  function announce(): void {
    const level = levelOf(length);
    if (level === announced) return;
    announced = level;
    if (level === 'near') {
      announcement = fill('contacto.contador.aviso_quedan', { quedan: String(max - length) });
    } else if (level === 'over') {
      announcement = fill('contacto.contador.aviso_exceso', { sobran: String(length - max) });
    } else {
      announcement = '';
    }
  }

  function onInput(): void {
    length = contactTextLength(textarea?.value ?? '');
    clearTimeout(timer);
    timer = setTimeout(announce, ANNOUNCE_DELAY_MS);
  }

  $effect(() => {
    // Lo que haya en el control al montar (también lo que restaure el navegador al volver atrás).
    length = contactTextLength(textarea?.value ?? '');
    announced = levelOf(length);
    mounted = true;
    return () => clearTimeout(timer);
  });
</script>

<div class="field">
  <label for="message">{t('contacto.campo.mensaje')}</label>
  <p id="message-help" class="help">{fill('contacto.ayuda.mensaje', { max: String(max) })}</p>
  {#if error}
    <FieldError id="message-error" text={error} />
  {/if}
  <textarea
    bind:this={textarea}
    id="message"
    name="message"
    rows="8"
    autocomplete="off"
    oninput={onInput}
    data-over={over ? 'true' : undefined}
    aria-describedby={describedBy}
    aria-invalid={error ? 'true' : undefined}
    aria-required="true">{value}</textarea
  >
  {#if mounted}
    <p id="message-counter" class="counter" class:counter-over={over}>
      {#if over}<span class="icon" aria-hidden="true">⚠</span>{/if}
      {counterText}
    </p>
    <span class="visually-hidden" role="status">{announcement}</span>
  {/if}
</div>
