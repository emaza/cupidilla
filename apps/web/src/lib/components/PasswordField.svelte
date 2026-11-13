<script lang="ts">
  import { t } from '#lib/texts.ts';
  import FieldError from './FieldError.svelte';

  interface Props {
    label: string;
    autocomplete: 'new-password' | 'current-password';
    help?: string;
    error?: string;
  }

  let { label, autocomplete, help, error }: Props = $props();

  // El botón «Mostrar contraseña» solo existe con JavaScript: se añade al montar (UX §2.3).
  // `null` mientras no hay JavaScript (también en el HTML del servidor).
  let visible = $state<boolean | null>(null);
  $effect(() => {
    visible ??= false;
  });

  const describedBy = $derived(
    [help ? 'password-help' : '', error ? 'password-error' : ''].filter(Boolean).join(' ') ||
      undefined,
  );
</script>

<div class="field">
  <label for="password">{label}</label>
  {#if help}
    <p id="password-help" class="help">{help}</p>
  {/if}
  {#if error}
    <FieldError id="password-error" text={error} />
  {/if}
  <div class="password-control">
    <input
      id="password"
      name="password"
      type={visible === true ? 'text' : 'password'}
      {autocomplete}
      autocapitalize="none"
      spellcheck="false"
      aria-describedby={describedBy}
      aria-invalid={error ? 'true' : undefined}
    />
    {#if visible !== null}
      <button
        type="button"
        class="button-text"
        aria-controls="password"
        onclick={() => (visible = !visible)}
      >
        {visible ? t('comun.contrasena.ocultar') : t('comun.contrasena.mostrar')}
      </button>
    {/if}
  </div>
</div>
