<script lang="ts">
  import { resolve } from '$app/paths';
  import { enhance } from '$app/forms';
  import SubmitButton from '#lib/components/SubmitButton.svelte';
  import UrlMessage from '#lib/components/UrlMessage.svelte';
  import { createSubmission } from '#lib/forms/submission.svelte.ts';
  import { fill, pageTitle, t } from '#lib/texts.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const submission = createSubmission();

  // Página de resultado: con JavaScript, el foco va al título para que se lea (correo UX §3.1).
  // Con un error de la URL, el foco lo toma el error.
  let heading: HTMLHeadingElement | undefined = $state();
  $effect(() => {
    if (data.message?.kind !== 'error') heading?.focus();
  });
</script>

<svelte:head>
  <title>{pageTitle('revisar.meta.titulo', data.message?.kind === 'error')}</title>
</svelte:head>

<UrlMessage message={data.message} />

<div class="card">
  <h1 tabindex="-1" bind:this={heading}>{t('revisar.titulo')}</h1>
  <p class="typed-email">{fill('revisar.texto.enviado', { correo: data.email })}</p>
  <p>{t('revisar.texto.siguiente')}</p>

  <h2>{t('revisar.ayuda.titulo')}</h2>
  <p class="typed-email">{fill('revisar.ayuda.texto', { correo: data.email })}</p>

  <form method="POST" action="?/resend" use:enhance={submission.submit}>
    <div class="actions">
      <SubmitButton
        label={t('correo.boton.reenviar')}
        sendingLabel={t('correo.boton.reenviando')}
        statusText={t('correo.estado.reenviando')}
        sending={submission.sending}
      />
    </div>
  </form>

  <p><a class="block-link" href={resolve('register')}>{t('revisar.enlace.otro_correo')}</a></p>
  <p><a class="block-link" href={resolve('login')}>{t('revisar.enlace.entrar')}</a></p>
</div>
