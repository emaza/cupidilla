<script lang="ts">
  import { resolve } from '$app/paths';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import PasswordField from '#lib/components/PasswordField.svelte';
  import SubmitButton from '#lib/components/SubmitButton.svelte';
  import UrlMessage from '#lib/components/UrlMessage.svelte';
  import { fill, pageTitle, t } from '#lib/texts.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

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
  /** Proveedor unido con el que se confirma (decisión 21). */
  const confirmWith = $derived(data.signIn.confirmWith);

  /** Proveedor en curso (solo con JavaScript): un segundo envío se ignora. */
  let sending = $state(false);
  function onsubmit(event: SubmitEvent) {
    if (sending) {
      event.preventDefault();
      return;
    }
    sending = true;
  }
</script>

<!-- Al volver con «atrás» desde el proveedor, la página puede salir de la caché del navegador. -->
<svelte:window onpageshow={() => (sending = false)} />

<svelte:head>
  <title>{pageTitle('contrasena.meta.titulo', hasErrors)}</title>
</svelte:head>

{#if form}
  <ErrorSummary
    items={passwordError ? [{ target: 'password', text: t(passwordError) }] : []}
    general={general ? t(general) : undefined}
  />
{:else}
  <UrlMessage message={data.message} />
{/if}

<div class="card">
  <h1>{t('contrasena.titulo')}</h1>

  {#if confirmWith}
    <div class="notice notice-info">
      <span class="icon" aria-hidden="true">ℹ</span>
      <p id="password-effect">{fill('contrasena.aviso.efecto', { proveedores: providerNames })}</p>
    </div>

    <dl class="data-list">
      <dt>{t('contrasena.campo.correo')}</dt>
      <dd class="provider-email">{data.email}</dd>
    </dl>

    <!-- Formulario nativo, sin use:enhance: acaba en un 303 al proveedor (decisión 21). -->
    {#key form}
      <form method="POST" action="?/create" novalidate {onsubmit}>
        <input type="hidden" name="provider" value={confirmWith} />
        <PasswordField
          label={t('contrasena.campo.contrasena')}
          autocomplete="new-password"
          help={t('registro.ayuda.contrasena')}
          describedBy="password-effect password-confirm"
          error={passwordError ? t(passwordError) : undefined}
        />
        <p id="password-confirm" class="help">
          {fill('contrasena.confirmar.texto', { proveedor: NAMES[confirmWith] })}
        </p>
        <div class="actions">
          <SubmitButton
            label={t('contrasena.boton.enviar')}
            sendingLabel={fill('proveedor.estado.conectando', { proveedor: NAMES[confirmWith] })}
            statusText={fill('proveedor.estado.conectando', { proveedor: NAMES[confirmWith] })}
            {sending}
          />
          <a class="block-link" href={resolve('account')}>{t('contrasena.enlace.cancelar')}</a>
        </div>
      </form>
    {/key}
  {:else}
    <p><a class="block-link" href={resolve('account')}>{t('contrasena.enlace.cancelar')}</a></p>
  {/if}
</div>
