<script lang="ts">
  import { t } from '#lib/texts.ts';
  import Notice from './Notice.svelte';

  /**
   * Aviso o error que llega en la URL tras una redirección (UX §2.2). El error sigue el patrón de
   * H0 §2.2 y, con JavaScript, recibe el foco; cancelar es informativo y no es un error.
   */
  let { message }: { message: { kind: 'notice' | 'error'; text: string } | null } = $props();

  let errorBlock: HTMLDivElement | undefined = $state();
  $effect(() => {
    if (message?.kind === 'error') errorBlock?.focus();
  });
</script>

{#if message?.kind === 'error'}
  <div class="error-summary" role="alert" tabindex="-1" bind:this={errorBlock}>
    <p>
      <span class="visually-hidden">{t('comun.error.prefijo_oculto')}</span>
      {message.text}
    </p>
  </div>
{:else if message}
  <Notice tone="info" text={message.text} />
{/if}
