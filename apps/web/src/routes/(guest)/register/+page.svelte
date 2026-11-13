<script lang="ts">
  import { resolve } from '$app/paths';
  import { SERVICE_TERMS_VERSION } from '@cupidilla/contracts';
  import { enhance } from '$app/forms';
  import EmailField from '#lib/components/EmailField.svelte';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import FieldError from '#lib/components/FieldError.svelte';
  import PasswordField from '#lib/components/PasswordField.svelte';
  import SubmitButton from '#lib/components/SubmitButton.svelte';
  import type { DatePart } from '#lib/forms/birth-date.ts';
  import { createSubmission } from '#lib/forms/submission.svelte.ts';
  import { fill, pageTitle, t } from '#lib/texts.ts';
  import type { PageProps } from './$types';

  let { form }: PageProps = $props();

  const submission = createSubmission();

  const values = $derived(form?.values);
  const fields = $derived(form?.errors?.fields ?? {});
  const general = $derived(form?.errors?.general);
  const invalidParts = $derived<DatePart[]>(form?.errors?.dateParts ?? []);
  const hasErrors = $derived(Object.keys(fields).length > 0 || general !== undefined);
  // La pantalla de menor no lleva «Error:»: no es un error que se pueda corregir.
  const title = $derived(
    form?.underage
      ? pageTitle('registro.menor.meta.titulo')
      : pageTitle('registro.meta.titulo', hasErrors),
  );

  const dateParts: {
    id: DatePart;
    label: string;
    maxlength: number;
    autocomplete: 'bday-day' | 'bday-month' | 'bday-year';
  }[] = [
    { id: 'day', label: t('registro.campo.dia'), maxlength: 2, autocomplete: 'bday-day' },
    { id: 'month', label: t('registro.campo.mes'), maxlength: 2, autocomplete: 'bday-month' },
    { id: 'year', label: t('registro.campo.anio'), maxlength: 4, autocomplete: 'bday-year' },
  ];

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

  <div class="card">
    <h1>{t('registro.titulo')}</h1>
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

        <fieldset
          class="birth-date"
          aria-describedby={fields.birthDate
            ? 'birth-date-help birth-date-error'
            : 'birth-date-help'}
        >
          <legend>{t('registro.campo.nacimiento')}</legend>
          <p id="birth-date-help" class="help">{t('registro.ayuda.nacimiento')}</p>
          {#if fields.birthDate}
            <FieldError id="birth-date-error" text={t(fields.birthDate)} />
          {/if}
          <div class="birth-date-parts">
            {#each dateParts as part (part.id)}
              {@const invalid = fields.birthDate !== undefined && invalidParts.includes(part.id)}
              <div class="date-part" class:date-part-year={part.id === 'year'}>
                <label for={part.id}>{part.label}</label>
                <input
                  id={part.id}
                  name={part.id}
                  type="text"
                  inputmode="numeric"
                  maxlength={part.maxlength}
                  autocomplete={part.autocomplete}
                  defaultValue={values?.[part.id] ?? ''}
                  aria-describedby={invalid ? 'birth-date-error' : undefined}
                  aria-invalid={invalid ? 'true' : undefined}
                />
              </div>
            {/each}
          </div>
        </fieldset>

        <div class="checkbox-block">
          {#if fields.acceptTerms}
            <FieldError id="accept-terms-error" text={t(fields.acceptTerms)} />
          {/if}
          <label class="checkbox">
            <input
              type="checkbox"
              id="acceptTerms"
              name="acceptTerms"
              defaultChecked={values?.acceptTerms ?? false}
              aria-describedby={fields.acceptTerms
                ? 'accept-terms-help accept-terms-error'
                : 'accept-terms-help'}
              aria-invalid={fields.acceptTerms ? 'true' : undefined}
            />
            <span>{fill('registro.campo.condiciones', { version: SERVICE_TERMS_VERSION })}</span>
          </label>
          <a class="block-link" href={resolve('legal/terms')} target="_blank" rel="noopener">
            {t('registro.enlace.condiciones')}
            {t('comun.nueva_pestana')}
          </a>
          <p id="accept-terms-help" class="help">{t('registro.ayuda.condiciones')}</p>
        </div>

        <input type="hidden" name="termsVersion" value={SERVICE_TERMS_VERSION} />

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
