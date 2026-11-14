<script lang="ts">
  import { resolve } from '$app/paths';
  import '../app.css';
  import { fill, t } from '#lib/texts.ts';
  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();
</script>

<a class="skip-link" href="#content">{t('comun.saltar')}</a>

<header class="site-header">
  <a class="brand" href={resolve('')}>{t('comun.marca')}</a>
  <nav class="site-nav" aria-label={t('comun.nav.etiqueta')}>
    <ul>
      {#if data.signedIn}
        <li><a href={resolve('account')}>{t('comun.nav.cuenta')}</a></li>
      {:else}
        <li><a href={resolve('login')}>{t('comun.nav.entrar')}</a></li>
        <li><a href={resolve('register')}>{t('comun.nav.registro')}</a></li>
      {/if}
    </ul>
  </nav>
</header>

<main id="content" tabindex="-1">
  {@render children()}
</main>

<footer class="site-footer">
  <a href={resolve('legal/terms')}>{t('comun.pie.condiciones')}</a>
  <span>{fill('comun.pie.edad', { edad: String(data.minAge) })}</span>
</footer>
