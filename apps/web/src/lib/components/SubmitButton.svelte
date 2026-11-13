<script lang="ts">
  interface Props {
    label: string;
    /** Texto del botón mientras se envía; sin él, no cambia. */
    sendingLabel?: string;
    /** Texto de la región oculta que anuncia el envío; sin él, no hay región. */
    statusText?: string;
    sending: boolean;
    variant?: 'primary' | 'danger';
  }

  let { label, sendingLabel, statusText, sending, variant = 'primary' }: Props = $props();
</script>

<!-- aria-disabled y no disabled: así no se pierde el foco; los envíos repetidos se ignoran. -->
<button type="submit" class="button button-{variant}" aria-disabled={sending ? 'true' : undefined}>
  {sending && sendingLabel ? sendingLabel : label}
</button>
{#if statusText}
  <span class="visually-hidden" role="status">{sending ? statusText : ''}</span>
{/if}
