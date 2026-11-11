<script lang="ts">
  import { t } from '#lib/texts.ts';

  interface Item {
    /** Id del control afectado, sin «#». */
    target: string;
    text: string;
  }

  interface Props {
    items?: Item[];
    /** Error general, sin campo. */
    general?: string;
  }

  let { items = [], general }: Props = $props();

  function focusTarget(event: MouseEvent, target: string) {
    const element = document.getElementById(target);
    if (!element) return;
    event.preventDefault();
    element.focus();
  }
</script>

{#if items.length > 0 || general}
  <div
    class="resumen-errores"
    tabindex="-1"
    role={general ? 'alert' : undefined}
    aria-labelledby="resumen-errores-titulo"
    data-foco-resultado
  >
    <h2 id="resumen-errores-titulo">{t('comun.error.resumen_titulo')}</h2>
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
    {/if}
  </div>
{/if}
