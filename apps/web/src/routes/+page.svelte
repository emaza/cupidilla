<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import Notice from '#lib/components/Notice.svelte';
  import { pageTitle, t, type TextKey } from '#lib/texts.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  /** Avisos tras redirigir: lista cerrada; un valor desconocido no muestra nada (acuerdo A7). */
  // Un `Map` y no un objeto literal: así `constructor`, `__proto__`… no encuentran nada heredado.
  const NOTICES = new Map<string, TextKey>([
    ['sesion-cerrada', 'portada.aviso.sesion_cerrada'],
    ['cuenta-eliminada', 'portada.aviso.cuenta_eliminada'],
  ]);

  const notice = $derived(NOTICES.get(page.url.searchParams.get('aviso') ?? ''));
</script>

<svelte:head>
  <title>{pageTitle('portada.meta.titulo')}</title>
</svelte:head>

{#if notice}
  <Notice tone="exito" text={t(notice)} />
{/if}

<h1>{t('portada.titulo')}</h1>
<p>{t('portada.texto.intro')}</p>
<p>{t('portada.texto.estado')}</p>

<div class="acciones">
  {#if data.signedIn}
    <a class="boton boton-primario" href={resolve('cuenta')}>{t('portada.boton.cuenta')}</a>
  {:else}
    <a class="boton boton-primario" href={resolve('registro')}>{t('portada.boton.registro')}</a>
    <a class="boton boton-secundario" href={resolve('entrar')}>{t('portada.boton.entrar')}</a>
  {/if}
</div>

<p class="pequeno">{t('comun.pie.edad')}</p>
