<script lang="ts">
  interface Props {
    text: string;
    tone: 'success' | 'info';
  }

  let { text, tone }: Props = $props();
</script>

<div class="notice notice-{tone}" role="status">
  {#if tone === 'success'}<span class="icon" aria-hidden="true">✓</span>{/if}
  <p>{text}</p>
</div>
