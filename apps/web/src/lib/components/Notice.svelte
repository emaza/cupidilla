<script lang="ts">
  interface Props {
    text: string;
    tone: 'exito' | 'info';
  }

  let { text, tone }: Props = $props();
</script>

<div class="aviso aviso-{tone}" role="status">
  {#if tone === 'exito'}<span class="icono" aria-hidden="true">✓</span>{/if}
  <p>{text}</p>
</div>
