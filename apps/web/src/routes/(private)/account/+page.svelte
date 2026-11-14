<script lang="ts">
  import { resolve } from '$app/paths';
  import { enhance } from '$app/forms';
  import type { OAuthProvider } from '@cupidilla/contracts';
  import ConfirmConnect from '#lib/components/ConfirmConnect.svelte';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import FieldError from '#lib/components/FieldError.svelte';
  import ProviderButtons from '#lib/components/ProviderButtons.svelte';
  import SubmitButton from '#lib/components/SubmitButton.svelte';
  import UrlMessage from '#lib/components/UrlMessage.svelte';
  import { createSubmission } from '#lib/forms/submission.svelte.ts';
  import { fill, pageTitle, t } from '#lib/texts.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const submission = createSubmission();
  const NAMES: Record<OAuthProvider, string> = { google: 'Google', facebook: 'Facebook' };

  /** Errores que vuelven de una acción (no de la URL). */
  const general = $derived.by((): string | undefined => {
    if (form && 'general' in form && form.general) return t(form.general);
    if (form && 'removeFailed' in form && form.removeFailed) {
      return fill('cuenta.error.quitar_servidor', { proveedor: NAMES[form.removeFailed] });
    }
    return undefined;
  });
  /** Contraseña vacía o errónea al quitar un proveedor (decisión 20). */
  const removeError = $derived(
    form && 'removeError' in form && form.removeError ? form.removeError : undefined,
  );
  const hasErrors = $derived(
    general !== undefined ||
      removeError !== undefined ||
      data.message?.kind === 'error' ||
      data.connect?.message.kind === 'error',
  );
  const signIn = $derived(data.signIn);
  /** Proveedor en curso de quitar (solo con JavaScript). */
  let removing = $state<OAuthProvider | null>(null);
</script>

<svelte:head>
  <title>{pageTitle('cuenta.meta.titulo', hasErrors)}</title>
</svelte:head>

{#if general}
  <div class="error-summary" role="alert" tabindex="-1" data-result-focus>
    <p>
      <span class="visually-hidden">{t('comun.error.prefijo_oculto')}</span>
      {general}
    </p>
  </div>
{:else if removeError}
  <ErrorSummary
    items={[{ target: `password-remove-${removeError.provider}`, text: t(removeError.password) }]}
  />
{:else if !form}
  <UrlMessage message={data.message} />
{/if}

<h1>{t('cuenta.titulo')}</h1>

{#if data.account}
  <section class="section" aria-labelledby="account-details">
    <h2 id="account-details">{t('cuenta.datos.titulo')}</h2>
    <dl class="data-list">
      <dt>{t('cuenta.datos.correo')}</dt>
      <dd>{data.account.email}</dd>
      {#if data.account.birthDate}
        <dt>{t('cuenta.datos.nacimiento')}</dt>
        <dd><time datetime={data.account.birthDate.iso}>{data.account.birthDate.text}</time></dd>
      {/if}
      {#if data.account.createdOn}
        <dt>{t('cuenta.datos.alta')}</dt>
        <dd><time datetime={data.account.createdOn.iso}>{data.account.createdOn.text}</time></dd>
      {/if}
      {#if data.account.sessionSince}
        <dt>{t('cuenta.datos.sesion')}</dt>
        <dd>
          <time datetime={data.account.sessionSince.iso}>{data.account.sessionSince.text}</time>
        </dd>
      {/if}
      {#if data.account.terms}
        <dt>{t('cuenta.datos.condiciones')}</dt>
        <dd>
          {fill('cuenta.datos.condiciones_valor', {
            version: data.account.terms.version,
            fecha: data.account.terms.acceptedOn,
          })}
        </dd>
      {/if}
    </dl>
  </section>
{/if}

{#if signIn}
  <section class="section" aria-labelledby="account-access">
    <h2 id="account-access">{t('cuenta.acceso.titulo')}</h2>
    <p>{t('cuenta.acceso.intro')}</p>
    <ul class="access-list">
      <li class="access-row">
        <div class="access-info">
          <span class="access-name">{t('cuenta.acceso.contrasena')}</span>
          <span class="access-state">
            {signIn.hasPassword
              ? t('cuenta.acceso.estado_activa')
              : t('cuenta.acceso.estado_sin_contrasena')}
          </span>
        </div>
        {#if !signIn.hasPassword}
          <a class="block-link" href={resolve('account/password')}
            >{t('cuenta.acceso.enlace_crear_contrasena')}</a
          >
        {/if}
      </li>
      {#each signIn.linked as item (item.provider)}
        <li class="access-row">
          <div class="access-info">
            <span class="access-name">{NAMES[item.provider]}</span>
            {#if item.linkedOn}
              <span class="access-state"
                >{fill('cuenta.acceso.estado_unido', { fecha: item.linkedOn })}</span
              >
            {/if}
            {#if item.lastUsedOn}
              <span class="access-state"
                >{fill('cuenta.acceso.ultimo_uso', { fecha: item.lastUsedOn })}</span
              >
            {/if}
          </div>
          {#if signIn.methods > 1}
            <form
              method="POST"
              action="?/removeIdentity"
              use:enhance={({ cancel }) => {
                // Un segundo envío mientras se quita otro proveedor se ignora.
                if (removing) {
                  cancel();
                  return;
                }
                removing = item.provider;
                return async ({ update }) => {
                  try {
                    await update();
                  } finally {
                    removing = null;
                  }
                };
              }}
            >
              <input type="hidden" name="provider" value={item.provider} />
              {#if signIn.hasPassword}
                {@const fieldId = `password-remove-${item.provider}`}
                {@const fieldError =
                  removeError?.provider === item.provider ? t(removeError.password) : undefined}
                <input type="hidden" name="withPassword" value="1" />
                <div class="field">
                  <label for={fieldId}>
                    {fill('cuenta.acceso.campo_quitar', { proveedor: NAMES[item.provider] })}
                  </label>
                  {#if fieldError}
                    <FieldError id="{fieldId}-error" text={fieldError} />
                  {/if}
                  <input
                    id={fieldId}
                    name="password"
                    type="password"
                    autocomplete="current-password"
                    autocapitalize="none"
                    spellcheck="false"
                    aria-describedby={fieldError ? `${fieldId}-error` : undefined}
                    aria-invalid={fieldError ? 'true' : undefined}
                  />
                </div>
              {/if}
              <SubmitButton
                label={fill('cuenta.acceso.boton_quitar', { proveedor: NAMES[item.provider] })}
                sendingLabel={t('cuenta.acceso.boton_quitando')}
                sending={removing === item.provider}
                variant="danger"
              />
            </form>
          {:else}
            <p class="help">{t('cuenta.acceso.ultima')}</p>
          {/if}
        </li>
      {/each}
      {#each signIn.addable as provider (provider)}
        <li class="access-row">
          <div class="access-info">
            <span class="access-name">{NAMES[provider]}</span>
            <span class="access-state">{t('cuenta.acceso.estado_no_unido')}</span>
          </div>
          <!-- Con contraseña, escribiéndola (decisión 20); sin ella, confirmando antes con un
               proveedor unido (decisión 21). -->
          {#if signIn.hasPassword}
            <ProviderButtons
              providers={[provider]}
              from="account"
              intent="connect"
              next="/account"
              withPassword
            />
          {:else if signIn.confirmWith}
            <ConfirmConnect
              {provider}
              confirmWith={signIn.confirmWith}
              message={data.connect?.provider === provider ? data.connect.message : null}
            />
          {/if}
        </li>
      {/each}
    </ul>
    <p class="help">{t('cuenta.acceso.nota')}</p>
  </section>
{/if}

{#if data.sessions && data.sessions.length > 0}
  <section class="section" aria-labelledby="account-sessions">
    <h2 id="account-sessions">{t('cuenta.sesiones.titulo')}</h2>
    <p>{t('cuenta.sesiones.intro')}</p>
    <ul class="session-list">
      {#each data.sessions as item (item.n)}
        <li class="session-row">
          <p class="session-name">
            {fill('cuenta.sesiones.nombre', { n: String(item.n) })}
            {#if item.current}
              <span class="session-tag">{t('cuenta.sesiones.actual')}</span><span
                class="visually-hidden">{t('cuenta.sesiones.item_actual_oculto')}</span
              >
            {/if}
          </p>
          <dl class="session-dates">
            {#if item.createdAt}
              <dt>{t('cuenta.sesiones.creada')}</dt>
              <dd><time datetime={item.createdAt.iso}>{item.createdAt.text}</time></dd>
            {/if}
            {#if item.authenticatedAt}
              <dt>{t('cuenta.sesiones.ultimo_inicio')}</dt>
              <dd><time datetime={item.authenticatedAt.iso}>{item.authenticatedAt.text}</time></dd>
            {/if}
            {#if item.expiresAt}
              <dt>{t('cuenta.sesiones.caduca')}</dt>
              <dd><time datetime={item.expiresAt.iso}>{item.expiresAt.text}</time></dd>
            {/if}
          </dl>
        </li>
      {/each}
    </ul>
    {#if data.sessions.length === 1}
      <p class="help">{t('cuenta.sesiones.unica')}</p>
    {/if}
    <p class="help">{t('cuenta.sesiones.nota')}</p>
  </section>
{/if}

<section class="section" aria-labelledby="account-cupidilla">
  <h2 id="account-cupidilla">{t('cuenta.cupidilla.titulo')}</h2>
  <p>{t('cuenta.cupidilla.texto')}</p>
</section>

<section class="section" aria-labelledby="account-session">
  <h2 id="account-session">{t('cuenta.sesion.titulo')}</h2>
  <form method="POST" action="/account?/logout" use:enhance={submission.submit}>
    <div class="actions">
      <SubmitButton label={t('cuenta.sesion.boton')} sending={submission.sending} />
    </div>
  </form>
</section>

<section class="section" aria-labelledby="account-delete">
  <h2 id="account-delete">{t('cuenta.eliminar.titulo')}</h2>
  <p>{t('cuenta.eliminar.texto')}</p>
  <div class="actions">
    <a class="button button-danger-secondary" href={resolve('account/delete')}
      >{t('cuenta.eliminar.enlace')}</a
    >
  </div>
</section>
