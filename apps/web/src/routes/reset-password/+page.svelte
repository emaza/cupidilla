<script lang="ts">
  import { enhance } from '$app/forms';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import LinkInvalid from '#lib/components/LinkInvalid.svelte';
  import PasswordField from '#lib/components/PasswordField.svelte';
  import SubmitButton from '#lib/components/SubmitButton.svelte';
  import { createSubmission } from '#lib/forms/submission.svelte.ts';
  import { linkInvalidTitle, pageTitle, t } from '#lib/texts.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const submission = createSubmission();

  const passwordError = $derived(form?.passwordError);
  const general = $derived(form?.general);
  const title = $derived(
    data.state === 'form'
      ? pageTitle('restablecer.meta.titulo', passwordError !== undefined || general !== undefined)
      : linkInvalidTitle('invalid'),
  );
</script>

<svelte:head>
  <title>{title}</title>
</svelte:head>

{#if data.state === 'form'}
  <ErrorSummary
    items={passwordError ? [{ target: 'password', text: t(passwordError) }] : []}
    general={general ? t(general) : undefined}
    generalLink={general === 'restablecer.error.resultado_incierto'
      ? { route: 'login', text: t('restablecer.enlace.comprobar') }
      : undefined}
  />

  <div class="card">
    <h1>{t('restablecer.titulo')}</h1>
    <p>{t('restablecer.texto.intro')}</p>
    <dl class="data-list">
      <dt>{t('enlace.campo.cuenta')}</dt>
      <dd translate="no">{data.emailHint}</dd>
    </dl>

    <!-- El token no va en el formulario: vive en una cookie de esta ruta (técnico §9.1). -->
    {#key form}
      <form method="POST" novalidate use:enhance={submission.submit}>
        {#if data.signedIn}
          <div class="notice notice-info">
            <span class="icon" aria-hidden="true">ℹ</span>
            <p id="session-notice">{t('restablecer.texto.sesion')}</p>
          </div>
        {/if}
        <PasswordField
          label={t('restablecer.campo.contrasena')}
          autocomplete="new-password"
          help={t('registro.ayuda.contrasena')}
          error={passwordError ? t(passwordError) : undefined}
          describedBy={data.signedIn ? 'session-notice' : undefined}
        />
        <div class="actions">
          <SubmitButton
            label={t('restablecer.boton.enviar')}
            sendingLabel={t('restablecer.boton.enviando')}
            statusText={t('restablecer.estado.enviando')}
            sending={submission.sending}
          />
        </div>
      </form>
    {/key}
  </div>
{:else}
  <LinkInvalid kind="invalid" emailVerified={null} purpose="reset" />
{/if}
