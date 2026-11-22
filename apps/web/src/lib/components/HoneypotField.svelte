<script lang="ts">
  import { CONTACT_HONEYPOT_FIELD } from '@cupidilla/contracts';
  import { t } from '#lib/texts.ts';

  /**
   * Campo trampa antispam (contacto UX §2.1.3, técnico §8.3): fuera de la pantalla, no con
   * `display:none`, que muchos bots detectan. No se alcanza con el tabulador, el lector de
   * pantalla no lo anuncia y nunca vuelve relleno a la página.
   */
</script>

<div class="trap" aria-hidden="true">
  <label for={CONTACT_HONEYPOT_FIELD}>{t('contacto.campo.trampa')}</label>
  <input
    type="text"
    id={CONTACT_HONEYPOT_FIELD}
    name={CONTACT_HONEYPOT_FIELD}
    tabindex="-1"
    autocomplete="off"
  />
</div>
