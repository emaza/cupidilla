<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { resolve } from '$app/paths';
  import type { OAuthProvider } from '@cupidilla/contracts';
  import { fill, t } from '#lib/texts.ts';
  import Notice from './Notice.svelte';
  import ProviderLogo from './ProviderLogo.svelte';

  /**
   * «Añadir {proveedor}» en una cuenta sin contraseña (decisión 21). Un solo formulario nativo
   * (`POST /auth/{provider}`, sin `use:enhance`): la API manda primero al proveedor unido para
   * confirmar y la web encadena después el proveedor nuevo, sin volver a /account.
   *
   * Con JavaScript, el botón de marca abre antes un panel que explica los dos pasos; sin él, envía
   * el formulario directamente. Si vuelve un error de este flujo, el panel sale abierto con él.
   */
  interface Props {
    /** Proveedor que se añade. */
    provider: OAuthProvider;
    /** Proveedor unido con el que se confirma (el usado más recientemente). */
    confirmWith: OAuthProvider;
    /** Resultado de este flujo que llega en la URL, ya resuelto a texto. */
    message: { kind: 'notice' | 'success' | 'error'; text: string } | null;
  }

  let { provider, confirmWith, message }: Props = $props();

  const NAMES: Record<OAuthProvider, string> = { google: 'Google', facebook: 'Facebook' };
  const LABELS = {
    google: 'proveedor.boton.google',
    facebook: 'proveedor.boton.facebook',
  } as const;

  const titleId = $derived(`confirm-connect-${provider}-title`);
  let open = $state(untrack(() => message !== null));
  let sending = $state(false);
  let trigger: HTMLButtonElement | undefined = $state();
  let title: HTMLHeadingElement | undefined = $state();
  let resultBlock: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (message?.kind === 'error') resultBlock?.focus();
  });

  async function openPanel(event: MouseEvent) {
    event.preventDefault();
    open = true;
    await tick();
    title?.focus();
  }

  async function closePanel(event?: Event) {
    event?.preventDefault();
    if (sending) return;
    open = false;
    await tick();
    trigger?.focus();
  }

  /** Un segundo envío mientras se redirige se ignora. */
  function onsubmit(event: SubmitEvent) {
    if (sending) {
      event.preventDefault();
      return;
    }
    sending = true;
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') void closePanel(event);
  }
</script>

<!-- Al volver con «atrás» desde el proveedor, la página puede salir de la caché del navegador. -->
<svelte:window onpageshow={() => (sending = false)} />

<form
  method="POST"
  action="/auth/{provider}"
  class="connect-form"
  class:connect-form-open={open}
  {onsubmit}
>
  <input type="hidden" name="from" value="account" />
  <input type="hidden" name="intent" value="connect" />
  <input type="hidden" name="next" value="/account" />
  {#if !open}
    <div class="provider-buttons">
      <button type="submit" class="button-provider" bind:this={trigger} onclick={openPanel}>
        <ProviderLogo {provider} />
        <span>{t(LABELS[provider])}</span>
      </button>
    </div>
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="confirm-panel" role="region" aria-labelledby={titleId} {onkeydown}>
      <h3 id={titleId} tabindex="-1" bind:this={title}>{t('cuenta.confirmar.titulo')}</h3>
      <p>
        {fill('cuenta.confirmar.texto', {
          proveedor: NAMES[confirmWith],
          proveedorNuevo: NAMES[provider],
        })}
      </p>
      {#if message?.kind === 'error'}
        <div class="error-summary" role="alert" tabindex="-1" bind:this={resultBlock}>
          <p>
            <span class="visually-hidden">{t('comun.error.prefijo_oculto')}</span>
            {message.text}
          </p>
        </div>
      {:else if message}
        <Notice tone={message.kind === 'success' ? 'success' : 'info'} text={message.text} />
      {/if}
      <div class="actions">
        <button
          type="submit"
          class="button button-primary"
          aria-disabled={sending ? 'true' : undefined}
          aria-busy={sending ? 'true' : undefined}
        >
          {sending
            ? fill('proveedor.estado.conectando', { proveedor: NAMES[confirmWith] })
            : fill('cuenta.confirmar.boton', { proveedor: NAMES[confirmWith] })}
        </button>
        <!-- Sin JavaScript, vuelve a /account sin el aviso; con él, cierra el panel. -->
        <a class="block-link" href={resolve('account')} onclick={closePanel}>
          {t('cuenta.confirmar.cancelar')}
        </a>
      </div>
    </div>
  {/if}
</form>
