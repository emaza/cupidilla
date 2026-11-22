<script lang="ts">
  import { resolve } from '$app/paths';
  import { pageTitle, t } from '#lib/texts.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  // El correo va en su propio elemento, sin traducir y partido si es largo (UX §2.2).
  const [beforeEmail, afterEmail] = t('contacto.enviado.texto2').split('{correo}');

  // Página de resultado: con JavaScript, el foco va al título para que se lea.
  let heading: HTMLHeadingElement | undefined = $state();
  $effect(() => {
    heading?.focus();
  });
</script>

<svelte:head>
  <title>{pageTitle('contacto.enviado.meta.titulo')}</title>
</svelte:head>

<div class="card">
  <h1 tabindex="-1" bind:this={heading}>{t('contacto.enviado.titulo')}</h1>
  <p>{t('contacto.enviado.texto1')}</p>
  <p>
    {beforeEmail}<span class="typed-email" translate="no">{data.email}</span>{afterEmail}
  </p>
  {#if data.ack}
    <p>{t('contacto.enviado.texto_acuse')}</p>
  {/if}

  <div class="actions">
    <a class="button button-primary" href={resolve('')}>{t('comun.boton.volver_inicio')}</a>
    <a class="button button-secondary" href={resolve('contact')}
      >{t('contacto.enviado.enlace_otro')}</a
    >
  </div>
</div>
