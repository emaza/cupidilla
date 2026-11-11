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
    [help ? 'ayuda-contrasena' : '', error ? 'error-contrasena' : ''].filter(Boolean).join(' ') ||
      undefined,
  );
</script>

<div class="campo">
  <label for="contrasena">{label}</label>
  {#if help}
    <p id="ayuda-contrasena" class="ayuda">{help}</p>
  {/if}
  {#if error}
    <FieldError id="error-contrasena" text={error} />
  {/if}
  <div class="control-contrasena">
    <input
      id="contrasena"
      name="contrasena"
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
        class="boton-texto"
        aria-controls="contrasena"
        onclick={() => (visible = !visible)}
      >
        {visible ? t('comun.contrasena.ocultar') : t('comun.contrasena.mostrar')}
      </button>
    {/if}
  </div>
</div>
