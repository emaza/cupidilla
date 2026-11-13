<script lang="ts">
  import { resolve } from '$app/paths';
  import { enhance } from '$app/forms';
  import type { OAuthProvider } from '@cupidilla/contracts';
  import BirthDateFieldset from '#lib/components/BirthDateFieldset.svelte';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import SubmitButton from '#lib/components/SubmitButton.svelte';
  import TermsCheckbox from '#lib/components/TermsCheckbox.svelte';
  import type { DatePart } from '#lib/forms/birth-date.ts';
  import { createSubmission } from '#lib/forms/submission.svelte.ts';
  import { fill, pageTitle, t, type TextKey } from '#lib/texts.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const submission = createSubmission();
  const NAMES: Record<OAuthProvider, string> = { google: 'Google', facebook: 'Facebook' };

  const providerName = $derived(data.pending ? NAMES[data.pending.provider] : '');
  /** Texto de una clave con el proveedor y los minutos sustituidos. */
  const text = (key: TextKey) =>
    fill(key, { proveedor: providerName, minutos: String(data.minutes) });

  const values = $derived(form && 'values' in form ? form.values : undefined);
  const errors = $derived(form && 'errors' in form ? form.errors : undefined);
  const fields = $derived(errors?.fields ?? {});
  const general = $derived(errors?.general);
  const invalidParts = $derived<DatePart[]>(errors?.dateParts ?? []);
  const underage = $derived(form && 'underage' in form ? form : undefined);
  const hasErrors = $derived(Object.keys(fields).length > 0 || general !== undefined);
  const title = $derived(
    underage ? pageTitle('registro.menor.meta.titulo') : pageTitle('alta.meta.titulo', hasErrors),
  );

  const summary = $derived(
    [
      { target: invalidParts[0] ?? 'day', key: fields.birthDate },
      { target: 'acceptTerms', key: fields.acceptTerms },
    ].flatMap(({ target, key }) => (key ? [{ target, text: t(key) }] : [])),
  );

  // Con JavaScript, el foco pasa al título de la pantalla de menor (UX §3.2.2).
  let underageHeading: HTMLHeadingElement | undefined = $state();
  $effect(() => {
    if (underage) underageHeading?.focus();
  });
</script>

<svelte:head>
  <title>{title}</title>
</svelte:head>

{#if underage}
  <div role="alert">
    <h1 tabindex="-1" bind:this={underageHeading} data-result-focus>
      {t('registro.menor.titulo')}
    </h1>
    <p>{t('registro.menor.texto1')}</p>
    {#if underage.provider}
      <p>{fill('alta.menor.texto3', { proveedor: NAMES[underage.provider] })}</p>
    {/if}
    <p>{t('registro.menor.texto2')}</p>
  </div>
  <div class="actions">
    <a class="button button-primary" href={resolve('')}>{t('comun.boton.volver_inicio')}</a>
  </div>
{:else if data.pending}
  <ErrorSummary
    items={summary}
    general={general ? text(general) : undefined}
    generalLink={general === 'alta.error.resultado_incierto'
      ? { route: 'login', text: text('alta.enlace.comprobar'), newTab: true }
      : undefined}
  />

  <div class="card">
    <h1>{t('alta.titulo')}</h1>
    <p>{text('alta.texto.intro')}</p>

    <dl class="data-list">
      <dt>{text('alta.campo.correo')}</dt>
      <dd class="provider-email">{data.pending.email}</dd>
    </dl>
    <p class="help">{text('alta.ayuda.correo')}</p>
    <p>{text('alta.texto.acceso')}</p>

    {#key form}
      <form method="POST" action="?/signup" novalidate use:enhance={submission.submit}>
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
            label={t('alta.boton.enviar')}
            sendingLabel={t('alta.boton.enviando')}
            statusText={t('alta.estado.enviando')}
            sending={submission.sending}
          />
        </div>
      </form>
    {/key}

    <p class="help">{text('alta.texto.caducidad')}</p>

    <!-- En su propio formulario y después del principal: Intro en un campo nunca cancela. -->
    <form method="POST" action="?/cancel">
      <button type="submit" class="link-button">{t('alta.boton.cancelar')}</button>
    </form>
  </div>
{/if}
