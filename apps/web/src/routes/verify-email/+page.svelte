<script lang="ts">
  import { enhance } from '$app/forms';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import LinkInvalid from '#lib/components/LinkInvalid.svelte';
  import PasswordField from '#lib/components/PasswordField.svelte';
  import SubmitButton from '#lib/components/SubmitButton.svelte';
  import { createSubmission } from '#lib/forms/submission.svelte.ts';
  import { FORGOT_PASSWORD_PATH } from '#lib/paths.ts';
  import { linkInvalidTitle, pageTitle, t } from '#lib/texts.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const submission = createSubmission();

  const passwordError = $derived(form?.passwordError ? t(form.passwordError) : undefined);
  const general = $derived(form?.general);
  const title = $derived(
    data.state === 'form'
      ? pageTitle('confirmar.meta.titulo', passwordError !== undefined || general !== undefined)
      : linkInvalidTitle(data.state),
  );
</script>

<svelte:head>
  <title>{title}</title>
</svelte:head>

{#if data.state === 'form'}
  <ErrorSummary
    items={passwordError ? [{ target: 'password', text: passwordError }] : []}
    general={general ? t(general) : undefined}
    generalLink={general === 'confirmar.error.resultado_incierto'
      ? { route: 'account', text: t('confirmar.enlace.comprobar') }
      : undefined}
  />

  <div class="card">
    <h1>{t('confirmar.titulo')}</h1>
    <p>{t('confirmar.texto')}</p>

    <!-- El token no va en el formulario: vive en una cookie de esta ruta (técnico §9.1). -->
    <form method="POST" action="?/confirm" novalidate use:enhance={submission.submit}>
      {#if data.needsPassword}
        <input type="hidden" name="withPassword" value="1" />
        {#if data.otherSession}
          <div class="notice notice-info">
            <span class="icon" aria-hidden="true">ℹ</span>
            <p id="other-session">{t('confirmar.texto.sesion_otra')}</p>
          </div>
        {/if}
        <p>{t('confirmar.texto.contrasena')}</p>
        <dl class="data-list">
          <dt>{t('enlace.campo.cuenta')}</dt>
          <dd translate="no">{data.emailHint}</dd>
        </dl>
        <PasswordField
          label={t('confirmar.campo.contrasena')}
          autocomplete="current-password"
          help={t('confirmar.ayuda.contrasena')}
          error={passwordError}
          describedBy={data.otherSession ? 'other-session' : undefined}
        />
        <p>
          <a class="block-link" href={FORGOT_PASSWORD_PATH}>{t('confirmar.enlace.olvido')}</a>
        </p>
        <p class="help">{t('confirmar.ayuda.olvido')}</p>
      {/if}
      <div class="actions">
        <SubmitButton
          label={t('confirmar.boton')}
          sendingLabel={t('confirmar.boton.enviando')}
          statusText={t('confirmar.estado.enviando')}
          sending={submission.sending}
        />
      </div>
    </form>
  </div>
{:else}
  <LinkInvalid kind={data.state} emailVerified={data.emailVerified} />
{/if}
