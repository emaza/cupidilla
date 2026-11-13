<script lang="ts">
  import { resolve } from '$app/paths';
  import { enhance } from '$app/forms';
  import EmailField from '#lib/components/EmailField.svelte';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import BirthDateFieldset from '#lib/components/BirthDateFieldset.svelte';
  import PasswordField from '#lib/components/PasswordField.svelte';
  import ProviderButtons from '#lib/components/ProviderButtons.svelte';
  import TermsCheckbox from '#lib/components/TermsCheckbox.svelte';
  import UrlMessage from '#lib/components/UrlMessage.svelte';
  import SubmitButton from '#lib/components/SubmitButton.svelte';
  import type { DatePart } from '#lib/forms/birth-date.ts';
  import { createSubmission } from '#lib/forms/submission.svelte.ts';
  import { pageTitle, t } from '#lib/texts.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const submission = createSubmission();

  const values = $derived(form?.values);
  const fields = $derived(form?.errors?.fields ?? {});
  const general = $derived(form?.errors?.general);
  const invalidParts = $derived<DatePart[]>(form?.errors?.dateParts ?? []);
  const hasErrors = $derived(
    Object.keys(fields).length > 0 || general !== undefined || data.message?.kind === 'error',
  );
  // La pantalla de menor no lleva «Error:»: no es un error que se pueda corregir.
  const title = $derived(
    form?.underage
      ? pageTitle('registro.menor.meta.titulo')
      : pageTitle('registro.meta.titulo', hasErrors),
  );

  const summary = $derived(
    [
      { target: 'email', key: fields.email },
      { target: 'password', key: fields.password },
      { target: invalidParts[0] ?? 'day', key: fields.birthDate },
      { target: 'acceptTerms', key: fields.acceptTerms },
    ].flatMap(({ target, key }) => (key ? [{ target, text: t(key) }] : [])),
  );

  // Con JavaScript, el foco pasa al título de la pantalla de menor (UX §3.2.2).
  let underageHeading: HTMLHeadingElement | undefined = $state();
  $effect(() => {
    if (form?.underage) underageHeading?.focus();
  });

  /** «entra» enlaza a /login dentro del mensaje de correo ya registrado (UX §3.2.1). */
  const emailTakenText = t('registro.error.correo_existente');
  const emailTakenLink = emailTakenText.indexOf('entra;');
</script>

<svelte:head>
  <title>{title}</title>
</svelte:head>

{#if form?.underage}
  <div role="alert">
    <h1 tabindex="-1" bind:this={underageHeading} data-result-focus>
      {t('registro.menor.titulo')}
    </h1>
    <p>{t('registro.menor.texto1')}</p>
    <p>{t('registro.menor.texto2')}</p>
  </div>
  <div class="actions">
    <a class="button button-primary" href={resolve('')}>{t('comun.boton.volver_inicio')}</a>
  </div>
{:else}
  <ErrorSummary
    items={summary}
    general={general ? t(general) : undefined}
    generalLink={general === 'registro.error.resultado_incierto'
      ? { route: 'login', text: t('registro.enlace.comprobar_entrada'), newTab: true }
      : undefined}
  />

  {#if !form}
    <UrlMessage message={data.message} />
  {/if}

  <div class="card">
    <h1>{t('registro.titulo')}</h1>

    {#if data.providers.length > 0}
      <ProviderButtons providers={data.providers} from="register" />
      <p class="help">{t('proveedor.ayuda.registro')}</p>
      <p class="provider-separator">{t('proveedor.separador.registro')}</p>
    {/if}

    <p>{t('comun.campos_obligatorios')}</p>

    {#key form}
      <form method="POST" novalidate use:enhance={submission.submit}>
        <EmailField
          label={t('registro.campo.correo')}
          value={values?.email ?? ''}
          error={fields.email ? t(fields.email) : undefined}
          errorContent={fields.email === 'registro.error.correo_existente' ? emailTaken : undefined}
        />

        <PasswordField
          label={t('registro.campo.contrasena')}
          autocomplete="new-password"
          help={t('registro.ayuda.contrasena')}
          error={fields.password ? t(fields.password) : undefined}
        />

        <BirthDateFieldset
          {values}
          error={fields.birthDate ? t(fields.birthDate) : undefined}
          {invalidParts}
        />

        <TermsCheckbox
          checked={values?.acceptTerms ?? false}
          error={fields.acceptTerms ? t(fields.acceptTerms) : undefined}
        />

        <div class="actions">
          <SubmitButton
            label={t('registro.boton.enviar')}
            sendingLabel={t('registro.boton.enviando')}
            statusText={t('registro.estado.enviando')}
            sending={submission.sending}
          />
        </div>
      </form>
    {/key}

    <p><a class="block-link" href={resolve('login')}>{t('registro.enlace.entrar')}</a></p>
  </div>
{/if}

{#snippet emailTaken()}
  {emailTakenText.slice(0, emailTakenLink)}<a href={resolve('login')}>entra</a
  >{emailTakenText.slice(emailTakenLink + 'entra'.length)}
{/snippet}
