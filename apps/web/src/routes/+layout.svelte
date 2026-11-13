<script lang="ts">
  import { resolve } from '$app/paths';
  import '../app.css';
  import { t } from '#lib/texts.ts';
  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();
</script>

<a class="saltar" href="#contenido">{t('comun.saltar')}</a>

<header class="cabecera">
  <a class="marca" href={resolve('')}>{t('comun.marca')}</a>
  <nav class="navegacion" aria-label={t('comun.nav.etiqueta')}>
    <ul>
      {#if data.signedIn}
        <li><a href={resolve('cuenta')}>{t('comun.nav.cuenta')}</a></li>
      {:else}
        <li><a href={resolve('entrar')}>{t('comun.nav.entrar')}</a></li>
        <li><a href={resolve('registro')}>{t('comun.nav.registro')}</a></li>
      {/if}
    </ul>
  </nav>
</header>

<main id="contenido" tabindex="-1">
  {@render children()}
</main>

<footer class="pie">
  <a href={resolve('legal/condiciones')}>{t('comun.pie.condiciones')}</a>
  <span>{t('comun.pie.edad')}</span>
</footer>
