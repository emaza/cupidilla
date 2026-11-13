<script lang="ts">
  import { resolve } from '$app/paths';
  import { t } from '#lib/texts.ts';

  interface Item {
    /** Id del control afectado, sin «#». */
    target: string;
    text: string;
  }

  interface GeneralLink {
    /** Página de destino, sin «/». */
    route: 'login' | 'account';
    text: string;
    /** Se abre en pestaña nueva y lo anuncia con `comun.nueva_pestana`. */
    newTab?: boolean;
  }

  interface Props {
    items?: Item[];
    /** Error general, sin campo. */
    general?: string;
    /** Enlace que acompaña al error general, tras el texto (p. ej. en el resultado incierto). */
    generalLink?: GeneralLink;
    /** Línea fija de ayuda tras el error general (p. ej. `entrar.ayuda.proveedor`). */
    generalHelp?: string;
  }

  let { items = [], general, generalLink, generalHelp }: Props = $props();

  function focusTarget(event: MouseEvent, target: string) {
    const element = document.getElementById(target);
    if (!element) return;
    event.preventDefault();
    element.focus();
  }
</script>

{#if items.length > 0 || general}
  <div
    class="error-summary"
    tabindex="-1"
    role={general ? 'alert' : undefined}
    aria-labelledby="error-summary-title"
    data-result-focus
  >
    <h2 id="error-summary-title">{t('comun.error.resumen_titulo')}</h2>
    {#if items.length > 0}
      <ul>
        {#each items as item (item.target)}
          <li>
            <a href={`#${item.target}`} onclick={(event) => focusTarget(event, item.target)}
              >{item.text}</a
            >
          </li>
        {/each}
      </ul>
    {/if}
    {#if general}
      <p>{general}</p>
      {#if generalHelp}
        <p>{generalHelp}</p>
      {/if}
      {#if generalLink}
        <p>
          {#if generalLink.newTab}
            <a href={resolve(generalLink.route)} target="_blank" rel="noopener">
              {generalLink.text}
              {t('comun.nueva_pestana')}
            </a>
          {:else}
            <!-- Carga completa y sin precarga: lo que muestre el destino tiene que ser el estado
                 actual del servidor, no datos precargados antes del error (p. ej. al pasar el
                 ratón por «Cancelar» mientras se enviaba). -->
            <a href={resolve(generalLink.route)} data-sveltekit-reload>{generalLink.text}</a>
          {/if}
        </p>
      {/if}
    {/if}
  </div>
{/if}
