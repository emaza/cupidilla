<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  import FieldError from './FieldError.svelte';

  interface Props {
    /** `id` y `name` del control. */
    name: string;
    label: string;
    /** Valor inicial (el que devuelve el servidor tras un error), en `defaultValue`. */
    value: string;
    help?: string;
    error?: string;
    type?: 'text' | 'tel';
    required?: boolean;
    autocomplete?: HTMLInputAttributes['autocomplete'];
    inputmode?: HTMLInputAttributes['inputmode'];
    autocapitalize?: HTMLInputAttributes['autocapitalize'];
  }

  let {
    name,
    label,
    value,
    help,
    error,
    type = 'text',
    required = false,
    autocomplete,
    inputmode,
    autocapitalize,
  }: Props = $props();

  const describedBy = $derived(
    [help ? `${name}-help` : '', error ? `${name}-error` : ''].filter(Boolean).join(' ') ||
      undefined,
  );
</script>

<!-- Campo de texto de una línea con etiqueta, ayuda y error (UX §2.2), sin placeholder. -->
<div class="field">
  <label for={name}>{label}</label>
  {#if help}
    <p id="{name}-help" class="help">{help}</p>
  {/if}
  {#if error}
    <FieldError id="{name}-error" text={error} />
  {/if}
  <input
    id={name}
    {name}
    {type}
    {autocomplete}
    {inputmode}
    {autocapitalize}
    defaultValue={value}
    aria-describedby={describedBy}
    aria-invalid={error ? 'true' : undefined}
    aria-required={required ? 'true' : undefined}
  />
</div>
