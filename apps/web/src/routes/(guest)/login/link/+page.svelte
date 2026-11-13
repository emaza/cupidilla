<script lang="ts">
  import { enhance } from '$app/forms';
  import type { OAuthProvider } from '@cupidilla/contracts';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import PasswordField from '#lib/components/PasswordField.svelte';
  import SubmitButton from '#lib/components/SubmitButton.svelte';
  import { createSubmission } from '#lib/forms/submission.svelte.ts';
  import { fill, pageTitle, t, type TextKey } from '#lib/texts.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const submission = createSubmission();
  const NAMES: Record<OAuthProvider, string> = { google: 'Google', facebook: 'Facebook' };
  const text = (key: TextKey) => fill(key, { proveedor: NAMES[data.pending.provider] });

  const passwordError = $derived(form?.errors?.fields?.password);
  const general = $derived(form?.errors?.general);
  const hasErrors = $derived(passwordError !== undefined || general !== undefined);
</script>

<svelte:head>
  <title>{pageTitle('union.meta.titulo', hasErrors)}</title>
</svelte:head>

<ErrorSummary
  items={passwordError ? [{ target: 'password', text: t(passwordError) }] : []}
  general={general ? text(general) : undefined}
/>

<div class="card">
  <h1>{t('union.titulo')}</h1>
  <p>{text('union.texto.intro')}</p>

  <dl class="data-list">
    <dt>{t('union.campo.correo')}</dt>
    <dd class="provider-email">{data.pending.email}</dd>
  </dl>

  {#key form}
    <form method="POST" action="?/link" novalidate use:enhance={submission.submit}>
      <!-- Para los gestores de contraseñas: no se envía (sin `name`) y no se ve (UX §3.3). -->
      <input
        class="visually-hidden"
        type="text"
        autocomplete="username"
        value={data.pending.email}
        readonly
        aria-hidden="true"
        tabindex="-1"
      />
      <PasswordField
        label={t('union.campo.contrasena')}
        autocomplete="current-password"
        help={t('union.ayuda.contrasena')}
        error={passwordError ? t(passwordError) : undefined}
      />
      <p class="help">{t('union.ayuda.olvido')}</p>

      <div class="actions">
        <SubmitButton
          label={t('union.boton.enviar')}
          sendingLabel={t('union.boton.enviando')}
          statusText={t('union.estado.enviando')}
          sending={submission.sending}
        />
      </div>
    </form>
  {/key}

  <!-- En su propio formulario y después del principal: Intro en el campo nunca cancela. -->
  <form method="POST" action="?/cancel">
    <button type="submit" class="link-button">{t('union.boton.cancelar')}</button>
  </form>
</div>
