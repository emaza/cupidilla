<script lang="ts">
  import { resolve } from '$app/paths';
  import { enhance } from '$app/forms';
  import CaptchaField from '#lib/components/CaptchaField.svelte';
  import CaptchaNoscript from '#lib/components/CaptchaNoscript.svelte';
  import EmailField from '#lib/components/EmailField.svelte';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import SubmitButton from '#lib/components/SubmitButton.svelte';
  import { createCaptcha } from '#lib/captcha/captcha.svelte.ts';
  import { CAPTCHA_FAILURES_FIELD, captchaErrorText } from '#lib/forms/captcha.ts';
  import { createSubmission } from '#lib/forms/submission.svelte.ts';
  import { pageTitle, t } from '#lib/texts.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const captcha = createCaptcha();
  const submission = createSubmission({ captcha });

  const emailError = $derived(form?.errors?.email);
  const captchaError = $derived(
    form?.errors?.captcha ? captchaErrorText(form.errors.captcha, data.supportEmail) : undefined,
  );
  const general = $derived(form?.errors?.general);
  const summary = $derived([
    ...(emailError ? [{ target: 'email', text: t(emailError) }] : []),
    ...(captchaError ? [{ target: 'captcha', text: captchaError }] : []),
  ]);
</script>

<svelte:head>
  <title>{pageTitle('olvido.meta.titulo', summary.length > 0 || general !== undefined)}</title>
</svelte:head>

<ErrorSummary items={summary} general={general ? t(general) : undefined} />

<div class="card">
  <h1>{t('olvido.titulo')}</h1>
  <p>{t('olvido.texto.intro')}</p>

  {#if data.captcha}
    <CaptchaNoscript form="olvido" supportEmail={data.supportEmail} />
  {/if}

  {#key form}
    <form method="POST" novalidate use:enhance={submission.submit}>
      <EmailField
        label={t('olvido.campo.correo')}
        value={form?.email ?? ''}
        error={emailError ? t(emailError) : undefined}
      />
      {#if data.captcha}
        <CaptchaField {captcha} error={captchaError} auto={form ? 'onload' : 'onfocus'} />
        <input type="hidden" name={CAPTCHA_FAILURES_FIELD} value={form?.captchaFailures ?? 0} />
      {/if}
      <div class="actions">
        <SubmitButton
          label={t('olvido.boton.enviar')}
          sendingLabel={t('olvido.boton.enviando')}
          statusText={submission.checking
            ? t('captcha.estado.enviando')
            : t('olvido.estado.enviando')}
          sending={submission.sending}
        />
      </div>
    </form>
  {/key}

  <p><a class="block-link" href={resolve('login')}>{t('olvido.enlace.entrar')}</a></p>
</div>
