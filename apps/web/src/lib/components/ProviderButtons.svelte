<script lang="ts">
  import type { OAuthProvider } from '@cupidilla/contracts';
  import { fill, t } from '#lib/texts.ts';
  import ProviderLogo from './ProviderLogo.svelte';

  interface Props {
    providers: readonly OAuthProvider[];
    /** Pantalla de origen (técnico §11.1). */
    from: 'login' | 'register' | 'account';
    /** Solo con `from = account`. */
    intent?: 'reauthenticate' | 'connect';
    /** Pantalla a la que volver; la web la pasa por la lista cerrada. */
    next?: string | null;
  }

  let { providers, from, intent, next }: Props = $props();

  const NAMES: Record<OAuthProvider, string> = { google: 'Google', facebook: 'Facebook' };
  const LABELS = {
    google: 'proveedor.boton.google',
    facebook: 'proveedor.boton.facebook',
  } as const;

  /** Proveedor cuyo formulario se está enviando (solo con JavaScript). */
  let sending = $state<OAuthProvider | null>(null);

  /**
   * POST nativo (sin `use:enhance`): acaba en un 303 a otro origen (UX §3.1.3). Con JavaScript
   * solo se marca el botón y se ignora un segundo envío; el texto visible no cambia.
   */
  function onsubmit(event: SubmitEvent, provider: OAuthProvider) {
    if (sending) {
      event.preventDefault();
      return;
    }
    sending = provider;
  }
</script>

<!-- Al volver con «atrás» desde el proveedor, la página puede salir de la caché del navegador. -->
<svelte:window onpageshow={() => (sending = null)} />

{#if providers.length > 0}
  <div class="provider-buttons" role="group" aria-label={t('proveedor.grupo.etiqueta')}>
    {#each providers as provider (provider)}
      <form method="POST" action="/auth/{provider}" onsubmit={(event) => onsubmit(event, provider)}>
        <input type="hidden" name="from" value={from} />
        {#if intent}<input type="hidden" name="intent" value={intent} />{/if}
        {#if next}<input type="hidden" name="next" value={next} />{/if}
        <button
          type="submit"
          class="button-provider"
          aria-disabled={sending === provider ? 'true' : undefined}
        >
          <ProviderLogo {provider} />
          <span>{t(LABELS[provider])}</span>
        </button>
      </form>
    {/each}
    <span class="visually-hidden" role="status">
      {sending ? fill('proveedor.estado.conectando', { proveedor: NAMES[sending] }) : ''}
    </span>
  </div>
{/if}
