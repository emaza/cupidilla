<script lang="ts">
  import { resolve } from '$app/paths';
  import { enhance } from '$app/forms';
  import EmailField from '#lib/components/EmailField.svelte';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import Notice from '#lib/components/Notice.svelte';
  import PasswordField from '#lib/components/PasswordField.svelte';
  import SubmitButton from '#lib/components/SubmitButton.svelte';
  import { createSubmission } from '#lib/forms/submission.svelte.ts';
  import { pageTitle, t } from '#lib/texts.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const submission = createSubmission();

  const fields = $derived(form?.errors?.fields ?? {});
  const general = $derived(form?.errors?.general);
  const hasErrors = $derived(Object.keys(fields).length > 0 || general !== undefined);
  const summary = $derived(
    [
      { target: 'correo', key: fields.correo },
      { target: 'contrasena', key: fields.contrasena },
    ].flatMap(({ target, key }) => (key ? [{ target, text: t(key) }] : [])),
  );
</script>

<svelte:head>
  <title>{pageTitle('entrar.meta.titulo', hasErrors)}</title>
</svelte:head>

<ErrorSummary items={summary} general={general ? t(general) : undefined} />

{#if data.next}
  <Notice tone="info" text={t('entrar.aviso.necesita_sesion')} />
{/if}

<div class="tarjeta">
  <h1>{t('entrar.titulo')}</h1>
  <p>{t('comun.campos_obligatorios')}</p>

  {#key form}
    <form method="POST" novalidate use:enhance={submission.submit}>
      {#if data.next}
        <input type="hidden" name="siguiente" value={data.next} />
      {/if}

      <EmailField
        label={t('entrar.campo.correo')}
        value={form?.values?.correo ?? ''}
        error={fields.correo ? t(fields.correo) : undefined}
      />

      <PasswordField
        label={t('entrar.campo.contrasena')}
        autocomplete="current-password"
        error={fields.contrasena ? t(fields.contrasena) : undefined}
      />

      <div class="acciones">
        <SubmitButton
          label={t('entrar.boton.enviar')}
          sendingLabel={t('entrar.boton.enviando')}
          statusText={t('entrar.estado.enviando')}
          sending={submission.sending}
        />
      </div>
    </form>
  {/key}

  <p><a class="enlace-bloque" href={resolve('registro')}>{t('entrar.enlace.registro')}</a></p>
</div>
