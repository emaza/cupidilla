<script lang="ts">
  import { resolve } from '$app/paths';
  import { enhance } from '$app/forms';
  import BirthDateFieldset from '#lib/components/BirthDateFieldset.svelte';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import SubmitButton from '#lib/components/SubmitButton.svelte';
  import TermsCheckbox from '#lib/components/TermsCheckbox.svelte';
  import UrlMessage from '#lib/components/UrlMessage.svelte';
  import type { DatePart } from '#lib/forms/birth-date.ts';
  import { createSubmission } from '#lib/forms/submission.svelte.ts';
  import { fill, pageTitle, t } from '#lib/texts.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  // Con un menor la acción borra la cuenta y la sesión: la pantalla de cierre se pinta sin volver
  // a cargar la página, que ya no tiene sesión.
  const submission = createSubmission({ navigateOnFailure: false });

  const values = $derived(form?.values);
  const fields = $derived(form?.errors?.fields ?? {});
  const general = $derived(form?.errors?.general);
  const invalidParts = $derived<DatePart[]>(form?.errors?.dateParts ?? []);
  const hasErrors = $derived(Object.keys(fields).length > 0 || general !== undefined);
  // La pantalla de menor no lleva «Error:»: no es un error que se pueda corregir.
  const title = $derived(
    form?.underage
      ? pageTitle('revision.menor.meta.titulo')
      : pageTitle('revision.meta.titulo', hasErrors),
  );

  const summary = $derived(
    [
      { target: invalidParts[0] ?? 'day', key: fields.birthDate },
      { target: 'acceptTerms', key: fields.acceptTerms },
    ].flatMap(({ target, key }) => (key ? [{ target, text: t(key) }] : [])),
  );

  // Con JavaScript, el foco pasa al título de la pantalla de menor.
  let underageHeading: HTMLHeadingElement | undefined = $state();
  $effect(() => {
    if (form?.underage) underageHeading?.focus();
  });
</script>

<svelte:head>
  <title>{title}</title>
</svelte:head>

{#if form?.underage}
  <div role="alert">
    <h1 tabindex="-1" bind:this={underageHeading} data-result-focus>
      {t('revision.menor.titulo')}
    </h1>
    <p>{fill('revision.menor.texto1', { edad: String(data.minAge) })}</p>
    <p>{t('registro.menor.texto2')}</p>
  </div>
  <div class="actions">
    <a class="button button-primary" href={resolve('')}>{t('comun.boton.volver_inicio')}</a>
  </div>
{:else}
  <ErrorSummary items={summary} general={general ? t(general) : undefined} />

  {#if !form}
    <UrlMessage message={data.message} />
  {/if}

  <div class="card">
    <h1>{t('revision.titulo')}</h1>
    <p>{t('revision.texto.intro')}</p>
    <p>{t('revision.texto.motivo')}</p>

    <!-- La fecha sale siempre vacía: la guardada pudo escribirla otra persona (UX §3.10). -->
    {#key form}
      <form method="POST" action="?/review" novalidate use:enhance={submission.submit}>
        <BirthDateFieldset
          minAge={data.minAge}
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
            label={t('revision.boton.enviar')}
            sendingLabel={t('revision.boton.enviando')}
            statusText={t('revision.estado.enviando')}
            sending={submission.sending}
          />
        </div>
      </form>
    {/key}

    <p class="help">{t('revision.texto.salir')}</p>
    <!-- En su propio formulario y después del principal: Intro en un campo nunca cierra sesión. -->
    <form method="POST" action="?/logout">
      <div class="actions">
        <button type="submit" class="button button-secondary">{t('cuenta.sesion.boton')}</button>
      </div>
    </form>
    <p><a class="block-link" href={resolve('account/delete')}>{t('cuenta.eliminar.enlace')}</a></p>
  </div>
{/if}
