<script lang="ts">
  import { fill, t } from '#lib/texts.ts';

  /**
   * Aviso sin JavaScript de la comprobación antibots (UX de captcha §5.3 y §6), en la cabecera del
   * formulario y antes del primer campo (decisión 4 del CTO). Svelte no hidrata el contenido de un
   * `<noscript>`: con JavaScript no existe en el DOM, así que su `id="captcha"` (el destino del
   * resumen sin JavaScript) no choca con el de `CaptchaField`.
   */
  interface Props {
    form: 'registro' | 'olvido' | 'contacto' | 'reenvio';
    supportEmail: string | null;
    /** Solo en /register: los proveedores configurados («Google», «Facebook»). */
    providers?: string[];
  }

  let { form, supportEmail, providers = [] }: Props = $props();

  const TEXTS = {
    registro: 'captcha.sin_js.registro',
    olvido: 'captcha.sin_js.olvido',
    contacto: 'captcha.sin_js.contacto',
    reenvio: 'captcha.sin_js.reenvio',
  } as const;

  const [beforeSupport, afterSupport] = t('captcha.sin_js.soporte').split('{soporte}');
</script>

<noscript>
  <div id="captcha" class="notice notice-info captcha-noscript" tabindex="-1">
    <span class="icon" aria-hidden="true">ℹ</span>
    <p>
      <strong>{t('captcha.sin_js.titulo')}.</strong>
      {t(TEXTS[form])}
      {#if form === 'registro' && providers.length > 0}
        {fill('captcha.sin_js.oauth', { proveedores: providers.join(' o ') })}
      {/if}
      {#if supportEmail}
        {beforeSupport}<a href="mailto:{supportEmail}" translate="no">{supportEmail}</a
        >{afterSupport}
      {/if}
      {#if form === 'registro'}
        {t('captcha.sin_js.conservado')}
      {/if}
    </p>
  </div>
</noscript>
