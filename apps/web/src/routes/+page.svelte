<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import Notice from '#lib/components/Notice.svelte';
  import { fill, pageTitle, t, type TextKey } from '#lib/texts.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  /** Avisos tras redirigir: lista cerrada; un valor desconocido no muestra nada (acuerdo A7). */
  // Un `Map` y no un objeto literal: así `constructor`, `__proto__`… no encuentran nada heredado.
  const NOTICES = new Map<string, TextKey>([
    ['signed-out', 'portada.aviso.sesion_cerrada'],
    ['account-deleted', 'portada.aviso.cuenta_eliminada'],
  ]);

  const notice = $derived(NOTICES.get(page.url.searchParams.get('notice') ?? ''));
</script>

<svelte:head>
  <title>{pageTitle('portada.meta.titulo')}</title>
</svelte:head>

{#if notice}
  <Notice tone="success" text={t(notice)} />
{/if}

<h1>{t('portada.titulo')}</h1>
<p>{t('portada.texto.intro')}</p>
<p>{t('portada.texto.estado')}</p>

<div class="actions">
  {#if data.signedIn}
    <a class="button button-primary" href={resolve('account')}>{t('portada.boton.cuenta')}</a>
  {:else}
    <a class="button button-primary" href={resolve('register')}>{t('portada.boton.registro')}</a>
    <a class="button button-secondary" href={resolve('login')}>{t('portada.boton.entrar')}</a>
  {/if}
</div>

<p class="small-print">{fill('comun.pie.edad', { edad: String(data.minAge) })}</p>
