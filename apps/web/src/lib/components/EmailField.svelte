<script lang="ts">
  import type { Snippet } from 'svelte';
  import FieldError from './FieldError.svelte';

  interface Props {
    label: string;
    /**
     * Valor inicial (el que devuelve el servidor tras un error). Va a `defaultValue`, no a `value`,
     * para que al hidratar no se borre lo que ya se haya escrito.
     */
    value: string;
    error?: string;
    /** Contenido del error cuando lleva un enlace. */
    errorContent?: Snippet;
    /** Texto de ayuda bajo la etiqueta. */
    help?: string;
  }

  let { label, value, error, errorContent, help }: Props = $props();

  const describedBy = $derived(
    [help ? 'email-help' : '', error ? 'email-error' : ''].filter(Boolean).join(' ') || undefined,
  );
</script>

<div class="field">
  <label for="email">{label}</label>
  {#if help}
    <p id="email-help" class="help">{help}</p>
  {/if}
  {#if error}
    <FieldError id="email-error" text={error} children={errorContent} />
  {/if}
  <input
    id="email"
    name="email"
    type="email"
    autocomplete="username"
    inputmode="email"
    autocapitalize="none"
    spellcheck="false"
    defaultValue={value}
    aria-describedby={describedBy}
    aria-invalid={error ? 'true' : undefined}
  />
</div>
