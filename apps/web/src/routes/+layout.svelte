<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import '../app.css';
  import { withSuffix } from '#lib/paths.ts';
  import { fill, t } from '#lib/texts.ts';
  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();

  // Pie (contacto UX §5): tres enlaces en su propio landmark; el de la página actual, marcado.
  const footerLinks = $derived([
    { href: resolve('legal/terms'), text: t('comun.pie.condiciones') },
    { href: resolve('legal/privacy'), text: t('comun.pie.privacidad') },
    { href: resolve('contact'), text: t('comun.pie.contacto') },
  ]);
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

{#if data.emailBanner}
  <!-- Persistente y no viva: no se anuncia en cada navegación (correo UX §3.7). -->
  <div class="email-banner" role="region" aria-label={t('correo.banda.etiqueta')}>
    <p>
      <span class="icon" aria-hidden="true">ℹ</span>
      {t('correo.banda.texto')}
      <a href={withSuffix(resolve('account'), '#correo')}>{t('correo.banda.enlace')}</a>
    </p>
  </div>
{/if}

<main id="content" tabindex="-1">
  {@render children()}
</main>

<footer class="site-footer">
  <nav aria-label={t('comun.pie.etiqueta')}>
    <ul>
      {#each footerLinks as link (link.href)}
        <li>
          <a href={link.href} aria-current={page.url.pathname === link.href ? 'page' : undefined}
            >{link.text}</a
          >
        </li>
      {/each}
    </ul>
  </nav>
  <span>{fill('comun.pie.edad', { edad: String(data.minAge) })}</span>
</footer>
