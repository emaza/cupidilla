<script lang="ts">
  import { resolve } from '$app/paths';
  import { enhance } from '$app/forms';
  import EmailField from '#lib/components/EmailField.svelte';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import SubmitButton from '#lib/components/SubmitButton.svelte';
  import { createSubmission } from '#lib/forms/submission.svelte.ts';
  import { pageTitle, t } from '#lib/texts.ts';
  import type { PageProps } from './$types';

  let { form }: PageProps = $props();

  const submission = createSubmission();

  const emailError = $derived(form?.errors?.email);
  const general = $derived(form?.errors?.general);
</script>

<svelte:head>
  <title>{pageTitle('olvido.meta.titulo', emailError !== undefined || general !== undefined)}</title
  >
</svelte:head>

<ErrorSummary
  items={emailError ? [{ target: 'email', text: t(emailError) }] : []}
  general={general ? t(general) : undefined}
/>

<div class="card">
  <h1>{t('olvido.titulo')}</h1>
  <p>{t('olvido.texto.intro')}</p>

  {#key form}
    <form method="POST" novalidate use:enhance={submission.submit}>
      <EmailField
        label={t('olvido.campo.correo')}
        value={form?.email ?? ''}
        error={emailError ? t(emailError) : undefined}
      />
      <div class="actions">
        <SubmitButton
          label={t('olvido.boton.enviar')}
          sendingLabel={t('olvido.boton.enviando')}
          statusText={t('olvido.estado.enviando')}
          sending={submission.sending}
        />
      </div>
    </form>
  {/key}

  <p><a class="block-link" href={resolve('login')}>{t('olvido.enlace.entrar')}</a></p>
</div>
