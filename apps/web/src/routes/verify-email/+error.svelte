<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import LinkInvalid from '#lib/components/LinkInvalid.svelte';
  import { linkInvalidTitle, pageTitle, t } from '#lib/texts.ts';

  // 410: el enlace no sirve, detectado al cargar (técnico de correo §9.1). El resto, como siempre.
  const gone = $derived(page.status === 410);
  const notFound = $derived(page.status === 404);
  const emailVerified = $derived((page.data.emailVerified as boolean | null | undefined) ?? null);
  const title = $derived(
    gone
      ? linkInvalidTitle('invalid')
      : pageTitle(notFound ? 'error404.titulo' : 'error500.titulo'),
  );
</script>

<svelte:head>
  <title>{title}</title>
</svelte:head>

{#if gone}
  <LinkInvalid kind="invalid" {emailVerified} />
{:else}
  <h1>{t(notFound ? 'error404.titulo' : 'error500.titulo')}</h1>
  <p>{t(notFound ? 'error404.texto' : 'error500.texto')}</p>
  <div class="actions">
    <a class="button button-primary" href={resolve('')}>{t('error.boton.inicio')}</a>
  </div>
{/if}
