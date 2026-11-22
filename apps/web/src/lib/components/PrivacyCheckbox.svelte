<script lang="ts">
  import { resolve } from '$app/paths';
  import { PRIVACY_POLICY_VERSION } from '@cupidilla/contracts';
  import { PRIVACY_VERSION_FIELD } from '#lib/forms/contact.ts';
  import { t } from '#lib/texts.ts';
  import FieldError from './FieldError.svelte';

  /**
   * Casilla de la política de privacidad (contacto UX §3.2), hermana de `TermsCheckbox`: el
   * enlace fuera de la etiqueta y en pestaña nueva, y la versión vigente en un campo oculto.
   */
  let { checked = false, error }: { checked?: boolean; error?: string } = $props();
</script>

<div class="checkbox-block">
  {#if error}
    <FieldError id="accept-privacy-error" text={error} />
  {/if}
  <label class="checkbox">
    <input
      type="checkbox"
      id="acceptPrivacy"
      name="acceptPrivacy"
      defaultChecked={checked}
      aria-describedby={error ? 'accept-privacy-help accept-privacy-error' : 'accept-privacy-help'}
      aria-invalid={error ? 'true' : undefined}
    />
    <span>{t('contacto.campo.privacidad')}</span>
  </label>
  <a class="block-link" href={resolve('legal/privacy')} target="_blank" rel="noopener">
    {t('contacto.enlace.privacidad')}
    {t('comun.nueva_pestana')}
  </a>
  <p id="accept-privacy-help" class="help">{t('contacto.ayuda.privacidad')}</p>
</div>

<input type="hidden" name={PRIVACY_VERSION_FIELD} value={PRIVACY_POLICY_VERSION} />
