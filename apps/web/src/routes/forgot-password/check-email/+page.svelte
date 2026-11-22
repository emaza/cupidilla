<script lang="ts">
  import { resolve } from '$app/paths';
  import { enhance } from '$app/forms';
  import CaptchaField from '#lib/components/CaptchaField.svelte';
  import CaptchaNoscript from '#lib/components/CaptchaNoscript.svelte';
  import SubmitButton from '#lib/components/SubmitButton.svelte';
  import UrlMessage from '#lib/components/UrlMessage.svelte';
  import { createCaptcha } from '#lib/captcha/captcha.svelte.ts';
  import { createSubmission } from '#lib/forms/submission.svelte.ts';
  import { fill, pageTitle, t } from '#lib/texts.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const captcha = createCaptcha();
  const submission = createSubmission({ captcha });

  // Página de resultado: con JavaScript, el foco va al título para que se lea (correo UX §3.4).
  // Con un error de la URL, el foco lo toma el error.
  let heading: HTMLHeadingElement | undefined = $state();
  $effect(() => {
    if (data.message?.kind !== 'error') heading?.focus();
  });
</script>

<svelte:head>
  <title>{pageTitle('olvido.revisar.meta.titulo', data.message?.kind === 'error')}</title>
</svelte:head>

<UrlMessage message={data.message} />

<div class="card">
  <h1 tabindex="-1" bind:this={heading}>{t('olvido.revisar.titulo')}</h1>
  <p class="typed-email">
    {fill('olvido.revisar.texto', { correo: data.email, duracion: data.duration })}
  </p>

  <h2>{t('revisar.ayuda.titulo')}</h2>
  <p>{t('olvido.revisar.ayuda')}</p>

  {#if data.captcha}
    <CaptchaNoscript form="reenvio" supportEmail={data.supportEmail} />
  {/if}
  <form method="POST" action="?/resend" novalidate use:enhance={submission.submit}>
    {#if data.captcha}
      <CaptchaField {captcha} auto="onload" variant="button" />
    {/if}
    <div class="actions">
      <SubmitButton
        label={t('olvido.revisar.boton')}
        sendingLabel={t('correo.boton.reenviando')}
        statusText={submission.checking
          ? t('captcha.estado.enviando')
          : t('correo.estado.reenviando')}
        sending={submission.sending}
      />
    </div>
  </form>

  <p>
    <a class="block-link" href={resolve('forgot-password')}>{t('olvido.revisar.enlace_otro')}</a>
  </p>
</div>
