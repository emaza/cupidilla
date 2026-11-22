<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { CAPTCHA_FIELD } from '@cupidilla/contracts';
  import { loadWidget } from '#lib/captcha/load-widget.ts';
  import type { Captcha } from '#lib/captcha/captcha.svelte.ts';
  import { t } from '#lib/texts.ts';
  import FieldError from './FieldError.svelte';

  /**
   * Comprobación antibots (técnico de captcha §8.1, UX de captcha §2). Solo se pinta con la
   * comprobación activada; el widget se carga en el navegador. El aviso sin JavaScript no va aquí,
   * sino en la cabecera del formulario (`CaptchaNoscript`, decisión 4 del CTO).
   *
   * `variant="button"`: formularios de un solo botón (reenvíos, UX §2.4). La caja no se ve salvo
   * en fallo (CSS sobre `data-state` del widget: `display="invisible"` de la 3.5.0 esconde también
   * el error) y el cálculo empieza al cargar la página.
   */
  interface Props {
    captcha: Captcha;
    /** Texto del error del servidor (`CAPTCHA_*`), ya resuelto. */
    error?: string;
    auto?: 'onfocus' | 'onload';
    variant?: 'field' | 'button';
  }

  let { captcha, error, auto = 'onfocus', variant = 'field' }: Props = $props();

  let mounted = $state(false);
  let loaded = $state(false);
  let widget: HTMLElement | undefined = $state();

  onMount(() => {
    mounted = true;
    loadWidget().then(
      () => (loaded = true),
      () => undefined,
    );
    return captcha.mount();
  });

  $effect(() => {
    if (!widget) return;
    const element = widget as NonNullable<Captcha['element']>;
    captcha.element = element;
    const detach = captcha.attach(element);
    // Si la persona ya estaba en un campo cuando el widget terminó de cargar, `onfocus` no se
    // enteraría hasta el siguiente campo: se empieza ya (UX §2.1, «al entrar en el primer campo»).
    const early = setTimeout(() => {
      const form = element.closest('form');
      if (auto === 'onfocus' && form?.contains(document.activeElement)) {
        if (element.getState?.() === 'unverified') void element.verify?.();
      }
    }, 0);
    return () => {
      clearTimeout(early);
      detach();
    };
  });

  // La casilla está dentro del widget: la ayuda, el error y el cálculo se le asocian a mano
  // (UX §2.2, §3.6). Se repite en cada cambio de estado, porque el widget vuelve a pintarla.
  $effect(() => {
    const state = captcha.state;
    const checkbox = captcha.element && loaded ? captcha.checkbox() : null;
    if (!checkbox) return;
    const describedBy = [variant === 'field' ? 'captcha-help' : '', error ? 'captcha-error' : '']
      .filter(Boolean)
      .join(' ');
    if (describedBy) checkbox.setAttribute('aria-describedby', describedBy);
    else checkbox.removeAttribute('aria-describedby');
    if (error) checkbox.setAttribute('aria-invalid', 'true');
    else checkbox.removeAttribute('aria-invalid');
    if (state === 'verifying') checkbox.setAttribute('aria-busy', 'true');
    else checkbox.removeAttribute('aria-busy');
  });
</script>

<!--
  Destino del enlace del resumen: con JavaScript, el foco pasa a la casilla (UX §4.2). El id solo
  existe con JavaScript: sin él, `#captcha` es el aviso `<noscript>` de la cabecera (UX §6.3).
-->
<div
  id={mounted ? 'captcha' : undefined}
  class="captcha-field"
  class:captcha-button={variant === 'button'}
  class:captcha-retry={captcha.timedOut}
  tabindex="-1"
  onfocus={(event) => {
    if (event.target === event.currentTarget) captcha.checkbox()?.focus();
  }}
>
  {#if variant === 'field'}
    <p id="captcha-help" class="help" class:captcha-help-done={captcha.state === 'verified'}>
      {captcha.expired && captcha.state !== 'verifying'
        ? t('captcha.widget.caducado')
        : t('captcha.ayuda')}
    </p>
  {/if}
  {#if error}
    <FieldError id="captcha-error" text={error} />
  {/if}
  {#if loaded}
    <altcha-widget
      bind:this={widget}
      name={CAPTCHA_FIELD}
      challenge={resolve('captcha/challenge')}
      {auto}
      type="checkbox"
      display="standard"
      language="es-es"
    ></altcha-widget>
  {/if}
  <!-- Existe desde el principio para que el aviso del tope se anuncie una sola vez (UX §4.1). -->
  <p class="captcha-alert" role="alert">{captcha.timedOut ? t('captcha.error.tiempo') : ''}</p>
</div>
