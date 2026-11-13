<script lang="ts">
  import { resolve } from '$app/paths';
  import { SERVICE_TERMS_VERSION } from '@cupidilla/contracts';
  import { fill, t } from '#lib/texts.ts';
  import FieldError from './FieldError.svelte';

  /**
   * Casilla de condiciones (H0 §3.2): desmarcada, con el enlace fuera de la etiqueta y en pestaña
   * nueva, y la versión vigente en un campo oculto. Común a /register y /register/complete.
   */
  let { checked = false, error }: { checked?: boolean; error?: string } = $props();
</script>

<div class="checkbox-block">
  {#if error}
    <FieldError id="accept-terms-error" text={error} />
  {/if}
  <label class="checkbox">
    <input
      type="checkbox"
      id="acceptTerms"
      name="acceptTerms"
      defaultChecked={checked}
      aria-describedby={error ? 'accept-terms-help accept-terms-error' : 'accept-terms-help'}
      aria-invalid={error ? 'true' : undefined}
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
