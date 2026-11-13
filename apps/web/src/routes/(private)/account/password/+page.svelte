<script lang="ts">
  import { resolve } from '$app/paths';
  import { enhance } from '$app/forms';
  import ConfirmIdentity from '#lib/components/ConfirmIdentity.svelte';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import PasswordField from '#lib/components/PasswordField.svelte';
  import SubmitButton from '#lib/components/SubmitButton.svelte';
  import UrlMessage from '#lib/components/UrlMessage.svelte';
  import { createSubmission } from '#lib/forms/submission.svelte.ts';
  import { fill, pageTitle, t } from '#lib/texts.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const submission = createSubmission();
  const NAMES = { google: 'Google', facebook: 'Facebook' } as const;
  /** «Google», «Facebook» o «Google y Facebook» (UX §5.7). */
  const providerNames = $derived(
    data.signIn.linked.map((item) => NAMES[item.provider]).join(' y '),
  );

  const errors = $derived(form && 'errors' in form ? form.errors : undefined);
  const passwordError = $derived(errors?.password);
  const general = $derived(errors?.general);
  const hasErrors = $derived(
    passwordError !== undefined || general !== undefined || data.message?.kind === 'error',
  );
</script>

<svelte:head>
  <title>{pageTitle('contrasena.meta.titulo', hasErrors)}</title>
</svelte:head>

{#if form}
  <ErrorSummary
    items={passwordError ? [{ target: 'password', text: t(passwordError) }] : []}
    general={general ? t(general) : undefined}
    generalLink={general === 'contrasena.error.resultado_incierto'
      ? { route: 'account', text: t('contrasena.enlace.comprobar') }
      : undefined}
  />
{:else}
  <UrlMessage message={data.message} />
{/if}

<div class="card">
  <h1>{t('contrasena.titulo')}</h1>

  {#if data.signIn.recent}
    <div class="notice notice-info">
      <span class="icon" aria-hidden="true">ℹ</span>
      <p id="password-effect">{fill('contrasena.aviso.efecto', { proveedores: providerNames })}</p>
    </div>

    <dl class="data-list">
      <dt>{t('contrasena.campo.correo')}</dt>
      <dd class="provider-email">{data.email}</dd>
    </dl>

    {#key form}
      <form method="POST" action="?/create" novalidate use:enhance={submission.submit}>
        <PasswordField
          label={t('contrasena.campo.contrasena')}
          autocomplete="new-password"
          help={t('registro.ayuda.contrasena')}
          describedBy="password-effect"
          error={passwordError ? t(passwordError) : undefined}
        />
        <div class="actions">
          <SubmitButton
            label={t('contrasena.boton.enviar')}
            sendingLabel={t('contrasena.boton.enviando')}
            statusText={t('contrasena.estado.enviando')}
            sending={submission.sending}
          />
          <a class="block-link" href={resolve('account')}>{t('contrasena.enlace.cancelar')}</a>
        </div>
      </form>
    {/key}
  {:else}
    <ConfirmIdentity
      action="verificar.accion.contrasena"
      providers={data.signIn.linked.map((item) => item.provider)}
      next="/account/password"
    />
    <p><a class="block-link" href={resolve('account')}>{t('contrasena.enlace.cancelar')}</a></p>
  {/if}
</div>
