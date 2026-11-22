<script lang="ts">
  import { resolve } from '$app/paths';
  import { enhance } from '$app/forms';
  import {
    CONTACT_MESSAGE_MAX,
    CONTACT_MESSAGE_MIN,
    CONTACT_NAME_MAX,
    CONTACT_SUBJECT_MAX,
    CONTACT_SUBJECT_MIN,
    contactTextLength,
  } from '@cupidilla/contracts';
  import EmailField from '#lib/components/EmailField.svelte';
  import ErrorSummary from '#lib/components/ErrorSummary.svelte';
  import HoneypotField from '#lib/components/HoneypotField.svelte';
  import MessageField from '#lib/components/MessageField.svelte';
  import PrivacyCheckbox from '#lib/components/PrivacyCheckbox.svelte';
  import SubmitButton from '#lib/components/SubmitButton.svelte';
  import TextField from '#lib/components/TextField.svelte';
  import { CONTACT_FIELDS, type ContactField } from '#lib/forms/contact.ts';
  import { createSubmission } from '#lib/forms/submission.svelte.ts';
  import { fill, pageTitle, t, type TextKey } from '#lib/texts.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const submission = createSubmission();

  const values = $derived(form?.values);
  const fields = $derived<Partial<Record<ContactField, TextKey>>>(form?.errors?.fields ?? {});
  const general = $derived(form?.errors?.general);
  const hasErrors = $derived(Object.keys(fields).length > 0 || general !== undefined);

  /** Texto de un error con sus límites de `contracts` (y la longitud del mensaje enviado). */
  function errorText(field: ContactField): string | undefined {
    const key = fields[field];
    if (!key) return undefined;
    const limits: Partial<Record<ContactField, { min?: number; max: number }>> = {
      name: { max: CONTACT_NAME_MAX },
      subject: { min: CONTACT_SUBJECT_MIN, max: CONTACT_SUBJECT_MAX },
      message: { min: CONTACT_MESSAGE_MIN, max: CONTACT_MESSAGE_MAX },
    };
    const { min, max } = limits[field] ?? {};
    return fill(key, {
      ...(min === undefined ? {} : { min: String(min) }),
      ...(max === undefined ? {} : { max: String(max) }),
      n: String(contactTextLength(values?.message ?? '')),
    });
  }

  const summary = $derived(
    CONTACT_FIELDS.flatMap((field) => {
      const text = errorText(field);
      return text ? [{ target: field, text }] : [];
    }),
  );

  // El enlace de la cláusula es «política de privacidad» dentro de su frase (UX §4).
  const POLICY_LINK = 'política de privacidad';
  const [beforePolicy, afterPolicy] = t('contacto.info.mas.texto').split(POLICY_LINK);
</script>

<svelte:head>
  <title>{pageTitle('contacto.meta.titulo', hasErrors)}</title>
</svelte:head>

<ErrorSummary items={summary} general={general ? t(general) : undefined} />

<div class="card">
  <h1>{t('contacto.titulo')}</h1>
  <p>{t('contacto.texto.intro')}</p>
  <p>{t('contacto.texto.obligatorios')}</p>

  {#key form}
    <form method="POST" novalidate use:enhance={submission.submit}>
      <TextField
        name="name"
        label={t('contacto.campo.nombre')}
        help={t('contacto.ayuda.nombre')}
        value={values?.name ?? ''}
        error={errorText('name')}
        autocomplete="name"
        autocapitalize="words"
        required
      />
      <EmailField
        label={t('contacto.campo.correo')}
        help={t('contacto.ayuda.correo')}
        value={values?.email ?? data.email}
        error={errorText('email')}
        autocomplete="email"
        required
      />
      <TextField
        name="phone"
        type="tel"
        label={t('contacto.campo.telefono')}
        help={t('contacto.ayuda.telefono')}
        value={values?.phone ?? ''}
        error={errorText('phone')}
        autocomplete="tel"
        inputmode="tel"
      />
      <TextField
        name="subject"
        label={t('contacto.campo.asunto')}
        help={fill('contacto.ayuda.asunto', { max: String(CONTACT_SUBJECT_MAX) })}
        value={values?.subject ?? ''}
        error={errorText('subject')}
        autocomplete="off"
        required
      />
      <MessageField value={values?.message ?? ''} error={errorText('message')} />
      <PrivacyCheckbox
        checked={values?.acceptPrivacy ?? false}
        error={errorText('acceptPrivacy')}
      />
      <HoneypotField />
      <div class="actions">
        <SubmitButton
          label={t('contacto.boton.enviar')}
          sendingLabel={t('contacto.boton.enviando')}
          statusText={t('contacto.estado.enviando')}
          sending={submission.sending}
        />
      </div>
    </form>
  {/key}

  <section class="small-print" aria-labelledby="contacto-info-titulo">
    <h2 id="contacto-info-titulo">{t('contacto.info.titulo')}</h2>
    <dl class="data-list">
      <dt>{t('contacto.info.responsable.etiqueta')}</dt>
      <dd>{t('contacto.info.responsable.texto')}</dd>
      <dt>{t('contacto.info.finalidad.etiqueta')}</dt>
      <dd>{t('contacto.info.finalidad.texto')}</dd>
      <dt>{t('contacto.info.base.etiqueta')}</dt>
      <dd>{t('contacto.info.base.texto')}</dd>
      <dt>{t('contacto.info.destinatarios.etiqueta')}</dt>
      <dd>{t('contacto.info.destinatarios.texto')}</dd>
      <dt>{t('contacto.info.derechos.etiqueta')}</dt>
      <dd>{t('contacto.info.derechos.texto')}</dd>
    </dl>
    <p>
      {beforePolicy}<a href={resolve('legal/privacy')} target="_blank" rel="noopener"
        >{POLICY_LINK} {t('comun.nueva_pestana')}</a
      >{afterPolicy}
    </p>
  </section>
</div>
