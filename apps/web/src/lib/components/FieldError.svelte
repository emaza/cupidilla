<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '#lib/texts.ts';

  interface Props {
    id: string;
    text: string;
    /** Contenido alternativo al texto, para los mensajes que llevan un enlace. */
    children?: Snippet;
  }

  let { id, text, children }: Props = $props();
</script>

<p {id} class="error-campo">
  <span class="visualmente-oculto">{t('comun.error.prefijo_oculto')}</span>
  <span class="icono" aria-hidden="true">⚠</span>
  {#if children}{@render children()}{:else}{text}{/if}
</p>
