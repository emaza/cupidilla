<script lang="ts">
  import { resolve } from '$app/paths';
  import { enhance } from '$app/forms';
  import EmailField from '#lib/components/EmailField.svelte';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import Notice from '#lib/components/Notice.svelte';
  import PasswordField from '#lib/components/PasswordField.svelte';
  import ProviderButtons from '#lib/components/ProviderButtons.svelte';
  import UrlMessage from '#lib/components/UrlMessage.svelte';
  import SubmitButton from '#lib/components/SubmitButton.svelte';
  import { createSubmission } from '#lib/forms/submission.svelte.ts';
  import { pageTitle, t } from '#lib/texts.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const submission = createSubmission();

  const fields = $derived(form?.errors?.fields ?? {});
  const general = $derived(form?.errors?.general);
  const hasErrors = $derived(
    Object.keys(fields).length > 0 || general !== undefined || data.message?.kind === 'error',
  );
  const summary = $derived(
    [
      { target: 'email', key: fields.email },
      { target: 'password', key: fields.password },
    ].flatMap(({ target, key }) => (key ? [{ target, text: t(key) }] : [])),
  );
</script>

<svelte:head>
  <title>{pageTitle('entrar.meta.titulo', hasErrors)}</title>
</svelte:head>

<ErrorSummary
  items={summary}
  general={general ? t(general) : undefined}
  generalHelp={general === 'entrar.error.credenciales' && data.providers.length > 0
    ? t('entrar.ayuda.proveedor')
    : undefined}
/>

{#if !form}
  <UrlMessage message={data.message} />
{/if}

{#if data.next}
  <Notice tone="info" text={t('entrar.aviso.necesita_sesion')} />
{/if}

<div class="card">
  <h1>{t('entrar.titulo')}</h1>

  {#if data.providers.length > 0}
    <ProviderButtons providers={data.providers} from="login" next={data.next} />
    <p class="provider-separator">{t('proveedor.separador.entrar')}</p>
  {/if}

  <p>{t('comun.campos_obligatorios')}</p>

  {#key form}
    <form method="POST" novalidate use:enhance={submission.submit}>
      {#if data.next}
        <input type="hidden" name="next" value={data.next} />
      {/if}

      <EmailField
        label={t('entrar.campo.correo')}
        value={form?.values?.email ?? ''}
        error={fields.email ? t(fields.email) : undefined}
      />

      <PasswordField
        label={t('entrar.campo.contrasena')}
        autocomplete="current-password"
        error={fields.password ? t(fields.password) : undefined}
      />

      <div class="actions">
        <SubmitButton
          label={t('entrar.boton.enviar')}
          sendingLabel={t('entrar.boton.enviando')}
          statusText={t('entrar.estado.enviando')}
          sending={submission.sending}
        />
      </div>
    </form>
  {/key}

  <p><a class="block-link" href={resolve('register')}>{t('entrar.enlace.registro')}</a></p>
</div>
