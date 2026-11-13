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
  }

  let { label, value, error, errorContent }: Props = $props();
</script>

<div class="field">
  <label for="email">{label}</label>
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
    aria-describedby={error ? 'email-error' : undefined}
    aria-invalid={error ? 'true' : undefined}
  />
</div>
