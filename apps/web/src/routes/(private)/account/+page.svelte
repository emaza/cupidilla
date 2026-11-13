<script lang="ts">
  import { resolve } from '$app/paths';
  import { enhance } from '$app/forms';
  import SubmitButton from '#lib/components/SubmitButton.svelte';
  import { createSubmission } from '#lib/forms/submission.svelte.ts';
  import { fill, pageTitle, t } from '#lib/texts.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const submission = createSubmission();
  const general = $derived(form?.general);
</script>

<svelte:head>
  <title>{pageTitle('cuenta.meta.titulo', general !== undefined)}</title>
</svelte:head>

{#if general}
  <div class="error-summary" role="alert" tabindex="-1" data-result-focus>
    <p>
      <span class="visually-hidden">{t('comun.error.prefijo_oculto')}</span>
      {t(general)}
    </p>
  </div>
{/if}

<h1>{t('cuenta.titulo')}</h1>

{#if data.account}
  <section class="section" aria-labelledby="account-details">
    <h2 id="account-details">{t('cuenta.datos.titulo')}</h2>
    <dl class="data-list">
      <dt>{t('cuenta.datos.correo')}</dt>
      <dd>{data.account.email}</dd>
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
