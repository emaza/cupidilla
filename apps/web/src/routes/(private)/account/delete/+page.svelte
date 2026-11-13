<script lang="ts">
  import { resolve } from '$app/paths';
  import { enhance } from '$app/forms';
  import ConfirmIdentity from '#lib/components/ConfirmIdentity.svelte';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import FieldError from '#lib/components/FieldError.svelte';
  import PasswordField from '#lib/components/PasswordField.svelte';
  import SubmitButton from '#lib/components/SubmitButton.svelte';
  import UrlMessage from '#lib/components/UrlMessage.svelte';
  import { createSubmission } from '#lib/forms/submission.svelte.ts';
  import { fill, pageTitle, t } from '#lib/texts.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const submission = createSubmission();
  const NAMES = { google: 'Google', facebook: 'Facebook' } as const;

  const signIn = $derived(data.signIn);
  /** Sin datos de la cuenta (la API falló al recargar tras un envío), el formulario de H0. */
  const hasPassword = $derived(signIn?.hasPassword ?? true);
  const providerNames = $derived(
    (signIn?.linked ?? []).map((item) => NAMES[item.provider]).join(' y '),
  );
  const scope = $derived(
    !signIn || signIn.linked.length === 0
      ? t('eliminar.texto.alcance')
      : fill(hasPassword ? 'eliminar.texto.alcance_mixta' : 'eliminar.texto.alcance_proveedor', {
          proveedores: providerNames,
        }),
  );

  const passwordError = $derived(form?.errors?.fields?.password);
  const confirmationError = $derived(form?.errors?.fields?.confirmation);
  const general = $derived(form?.errors?.general);
  const hasErrors = $derived(
    passwordError !== undefined ||
      confirmationError !== undefined ||
      general !== undefined ||
      data.message?.kind === 'error',
  );
  /** Proveedor del texto de resultado incierto: el que devolvió la acción o el primero unido. */
  const failedProvider = $derived.by(() => {
    const provider: unknown = form && 'provider' in form ? form.provider : undefined;
    return provider === 'google' || provider === 'facebook' ? NAMES[provider] : undefined;
  });
  const generalText = $derived(
    general
      ? fill(general, { proveedor: failedProvider ?? providerNames.split(' y ')[0] ?? '' })
      : undefined,
  );
</script>

<svelte:head>
  <title>{pageTitle('eliminar.meta.titulo', hasErrors)}</title>
</svelte:head>

{#if form}
  <ErrorSummary
    items={[
      ...(passwordError ? [{ target: 'password', text: t(passwordError) }] : []),
      ...(confirmationError ? [{ target: 'confirmation', text: t(confirmationError) }] : []),
    ]}
    general={generalText}
    generalLink={general === 'eliminar.error.resultado_incierto' ||
    general === 'eliminar.error.resultado_incierto_proveedor'
      ? { route: 'account', text: t('eliminar.enlace.comprobar') }
      : undefined}
  />
{:else}
  <UrlMessage message={data.message} />
{/if}

<div class="card">
  <h1>{t('eliminar.titulo')}</h1>
  <p>{scope}</p>
  <p>{t('eliminar.texto.irreversible')}</p>

  {#if hasPassword}
    {#key form}
      <form method="POST" action="?/password" novalidate use:enhance={submission.submit}>
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
  {:else if signIn?.recent}
    {#key form}
      <form method="POST" action="?/confirm" novalidate use:enhance={submission.submit}>
        <div class="field">
          <label for="confirmation">{t('eliminar.campo.confirmacion')}</label>
          <p id="confirmation-help" class="help">{t('eliminar.ayuda.confirmacion')}</p>
          {#if confirmationError}
            <FieldError id="confirmation-error" text={t(confirmationError)} />
          {/if}
          <input
            id="confirmation"
            name="confirmation"
            type="text"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            aria-describedby={confirmationError
              ? 'confirmation-help confirmation-error'
              : 'confirmation-help'}
            aria-invalid={confirmationError ? 'true' : undefined}
          />
        </div>

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
  {:else if signIn}
    <ConfirmIdentity
      action="verificar.accion.eliminar"
      providers={signIn.linked.map((item) => item.provider)}
      hasPassword={false}
      next="/account/delete"
    />
    <p><a class="block-link" href={resolve('account')}>{t('eliminar.enlace.cancelar')}</a></p>
  {/if}
</div>
