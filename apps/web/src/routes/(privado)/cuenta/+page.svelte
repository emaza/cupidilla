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
  <div class="resumen-errores" role="alert" tabindex="-1" data-foco-resultado>
    <p>
      <span class="visualmente-oculto">{t('comun.error.prefijo_oculto')}</span>
      {t(general)}
    </p>
  </div>
{/if}

<h1>{t('cuenta.titulo')}</h1>

{#if data.account}
  <section class="seccion" aria-labelledby="cuenta-datos">
    <h2 id="cuenta-datos">{t('cuenta.datos.titulo')}</h2>
    <dl class="datos">
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

<section class="seccion" aria-labelledby="cuenta-cupidilla">
  <h2 id="cuenta-cupidilla">{t('cuenta.cupidilla.titulo')}</h2>
  <p>{t('cuenta.cupidilla.texto')}</p>
</section>

<section class="seccion" aria-labelledby="cuenta-sesion">
  <h2 id="cuenta-sesion">{t('cuenta.sesion.titulo')}</h2>
  <form method="POST" action="/cuenta?/salir" use:enhance={submission.submit}>
    <div class="acciones">
      <SubmitButton label={t('cuenta.sesion.boton')} sending={submission.sending} />
    </div>
  </form>
</section>

<section class="seccion" aria-labelledby="cuenta-eliminar">
  <h2 id="cuenta-eliminar">{t('cuenta.eliminar.titulo')}</h2>
  <p>{t('cuenta.eliminar.texto')}</p>
  <div class="acciones">
    <a class="boton boton-peligro-secundario" href={resolve('cuenta/eliminar')}
      >{t('cuenta.eliminar.enlace')}</a
    >
  </div>
</section>
