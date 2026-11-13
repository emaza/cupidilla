<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { pageTitle, t } from '#lib/texts.ts';

  // Solo hay dos páginas de error: 404 y el resto (500). Nunca se muestran trazas ni códigos.
  const notFound = $derived(page.status === 404);
</script>

<svelte:head>
  <title>{pageTitle(notFound ? 'error404.titulo' : 'error500.titulo')}</title>
</svelte:head>

<h1>{t(notFound ? 'error404.titulo' : 'error500.titulo')}</h1>
<p>{t(notFound ? 'error404.texto' : 'error500.texto')}</p>
<div class="actions">
  <a class="button button-primary" href={resolve('')}>{t('error.boton.inicio')}</a>
</div>
