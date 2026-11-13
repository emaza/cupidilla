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
    { id: 'dia', label: t('registro.campo.dia'), maxlength: 2, autocomplete: 'bday-day' },
    { id: 'mes', label: t('registro.campo.mes'), maxlength: 2, autocomplete: 'bday-month' },
    { id: 'anio', label: t('registro.campo.anio'), maxlength: 4, autocomplete: 'bday-year' },
  ];

  const summary = $derived(
    [
      { target: 'correo', key: fields.correo },
      { target: 'contrasena', key: fields.contrasena },
      { target: invalidParts[0] ?? 'dia', key: fields.fecha },
      { target: 'condiciones', key: fields.condiciones },
    ].flatMap(({ target, key }) => (key ? [{ target, text: t(key) }] : [])),
  );

  // Con JavaScript, el foco pasa al título de la pantalla de menor (UX §3.2.2).
  let underageHeading: HTMLHeadingElement | undefined = $state();
  $effect(() => {
    if (form?.underage) underageHeading?.focus();
  });

  /** «entra» enlaza a /entrar dentro del mensaje de correo ya registrado (UX §3.2.1). */
  const emailTakenText = t('registro.error.correo_existente');
  const emailTakenLink = emailTakenText.indexOf('entra;');
</script>

<svelte:head>
  <title>{title}</title>
</svelte:head>

{#if form?.underage}
  <div role="alert">
    <h1 tabindex="-1" bind:this={underageHeading} data-foco-resultado>
      {t('registro.menor.titulo')}
    </h1>
    <p>{t('registro.menor.texto1')}</p>
    <p>{t('registro.menor.texto2')}</p>
  </div>
  <div class="acciones">
    <a class="boton boton-primario" href={resolve('')}>{t('comun.boton.volver_inicio')}</a>
  </div>
{:else}
  <ErrorSummary
    items={summary}
    general={general ? t(general) : undefined}
    generalLink={general === 'registro.error.resultado_incierto'
      ? { route: 'entrar', text: t('registro.enlace.comprobar_entrada'), newTab: true }
      : undefined}
  />

  <div class="tarjeta">
    <h1>{t('registro.titulo')}</h1>
    <p>{t('comun.campos_obligatorios')}</p>

    {#key form}
      <form method="POST" novalidate use:enhance={submission.submit}>
        <EmailField
          label={t('registro.campo.correo')}
          value={values?.correo ?? ''}
          error={fields.correo ? t(fields.correo) : undefined}
          errorContent={fields.correo === 'registro.error.correo_existente'
            ? emailTaken
            : undefined}
        />

        <PasswordField
          label={t('registro.campo.contrasena')}
          autocomplete="new-password"
          help={t('registro.ayuda.contrasena')}
          error={fields.contrasena ? t(fields.contrasena) : undefined}
        />

        <fieldset
          class="fecha"
          aria-describedby={fields.fecha ? 'ayuda-nacimiento error-fecha' : 'ayuda-nacimiento'}
        >
          <legend>{t('registro.campo.nacimiento')}</legend>
          <p id="ayuda-nacimiento" class="ayuda">{t('registro.ayuda.nacimiento')}</p>
          {#if fields.fecha}
            <FieldError id="error-fecha" text={t(fields.fecha)} />
          {/if}
          <div class="fecha-partes">
            {#each dateParts as part (part.id)}
              {@const invalid = fields.fecha !== undefined && invalidParts.includes(part.id)}
              <div class="parte" class:parte-anio={part.id === 'anio'}>
                <label for={part.id}>{part.label}</label>
                <input
                  id={part.id}
                  name={part.id}
                  type="text"
                  inputmode="numeric"
                  maxlength={part.maxlength}
                  autocomplete={part.autocomplete}
                  defaultValue={values?.[part.id] ?? ''}
                  aria-describedby={invalid ? 'error-fecha' : undefined}
                  aria-invalid={invalid ? 'true' : undefined}
                />
              </div>
            {/each}
          </div>
        </fieldset>

        <div class="casilla-bloque">
          {#if fields.condiciones}
            <FieldError id="error-condiciones" text={t(fields.condiciones)} />
          {/if}
          <label class="casilla">
            <input
              type="checkbox"
              id="condiciones"
              name="condiciones"
              defaultChecked={values?.condiciones ?? false}
              aria-describedby={fields.condiciones
                ? 'ayuda-condiciones error-condiciones'
                : 'ayuda-condiciones'}
              aria-invalid={fields.condiciones ? 'true' : undefined}
            />
            <span>{fill('registro.campo.condiciones', { version: SERVICE_TERMS_VERSION })}</span>
          </label>
          <a
            class="enlace-bloque"
            href={resolve('legal/condiciones')}
            target="_blank"
            rel="noopener"
          >
            {t('registro.enlace.condiciones')}
            {t('comun.nueva_pestana')}
          </a>
          <p id="ayuda-condiciones" class="ayuda">{t('registro.ayuda.condiciones')}</p>
        </div>

        <input type="hidden" name="version_condiciones" value={SERVICE_TERMS_VERSION} />

        <div class="acciones">
          <SubmitButton
            label={t('registro.boton.enviar')}
            sendingLabel={t('registro.boton.enviando')}
            statusText={t('registro.estado.enviando')}
            sending={submission.sending}
          />
        </div>
      </form>
    {/key}

    <p><a class="enlace-bloque" href={resolve('entrar')}>{t('registro.enlace.entrar')}</a></p>
  </div>
{/if}

{#snippet emailTaken()}
  {emailTakenText.slice(0, emailTakenLink)}<a href={resolve('entrar')}>entra</a
  >{emailTakenText.slice(emailTakenLink + 'entra'.length)}
{/snippet}
