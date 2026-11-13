<script lang="ts">
  import { resolve } from '$app/paths';
  import { enhance } from '$app/forms';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import PasswordField from '#lib/components/PasswordField.svelte';
  import SubmitButton from '#lib/components/SubmitButton.svelte';
  import { createSubmission } from '#lib/forms/submission.svelte.ts';
  import { pageTitle, t } from '#lib/texts.ts';
  import type { PageProps } from './$types';

  let { form }: PageProps = $props();

  const submission = createSubmission();

  const passwordError = $derived(form?.errors?.fields?.password);
  const general = $derived(form?.errors?.general);
  const hasErrors = $derived(passwordError !== undefined || general !== undefined);
</script>

<svelte:head>
  <title>{pageTitle('eliminar.meta.titulo', hasErrors)}</title>
</svelte:head>

<ErrorSummary
  items={passwordError ? [{ target: 'password', text: t(passwordError) }] : []}
  general={general ? t(general) : undefined}
  generalLink={general === 'eliminar.error.resultado_incierto'
    ? { route: 'account', text: t('eliminar.enlace.comprobar') }
    : undefined}
/>

<div class="card">
  <h1>{t('eliminar.titulo')}</h1>
  <p>{t('eliminar.texto.alcance')}</p>
  <p>{t('eliminar.texto.irreversible')}</p>

  {#key form}
    <form method="POST" novalidate use:enhance={submission.submit}>
      <PasswordField
        label={t('eliminar.campo.contrasena')}
        autocomplete="current-password"
        help={t('eliminar.ayuda.contrasena')}
        error={passwordError ? t(passwordError) : undefined}
      />

      <div class="actions">
        <SubmitButton
          label={t('eliminar.boton.enviar')}
          sendingLabel={t('eliminar.boton.enviando')}
          statusText={t('eliminar.estado.enviando')}
          sending={submission.sending}
          variant="danger"
        />
        <a class="block-link" href={resolve('account')}>{t('eliminar.enlace.cancelar')}</a>
      </div>
    </form>
  {/key}
</div>
