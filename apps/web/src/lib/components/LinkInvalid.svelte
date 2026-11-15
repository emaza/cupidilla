<script lang="ts">
  import { resolve } from '$app/paths';
  import { withSuffix } from '#lib/paths.ts';
  import { t } from '#lib/texts.ts';

  /**
   * «Este enlace ya no sirve» y «Hemos anulado este enlace» (correo UX §3.6). La pantalla es el
   * estado: no hay formulario del enlace, solo el paso siguiente según la sesión (§1.4). El
   * `<title>` lo pone la página (`linkInvalidTitle`).
   */
  interface Props {
    kind: 'invalid' | 'attempts';
    /** `null` sin sesión; si no, si la cuenta de la sesión tiene el correo confirmado. */
    emailVerified: boolean | null;
    /** Enlace de confirmar (`/verify-email`) o de restablecer (`/reset-password`). */
    purpose?: 'verify' | 'reset';
  }

  let { kind, emailVerified, purpose = 'verify' }: Props = $props();

  let heading: HTMLHeadingElement | undefined = $state();
  $effect(() => {
    heading?.focus();
  });
</script>

<div class="card">
  {#if kind === 'attempts'}
    <h1 tabindex="-1" bind:this={heading}>{t('enlace.intentos.titulo')}</h1>
    <p>{t('enlace.intentos.texto')}</p>
    <p>{t('enlace.intentos.siguiente')}</p>
    <div class="actions">
      <a class="button button-primary" href={resolve('forgot-password')}
        >{t('enlace.boton.recuperar')}</a
      >
    </div>
  {:else}
    <h1 tabindex="-1" bind:this={heading}>{t('enlace.titulo')}</h1>
    <p>{t('enlace.texto')}</p>
    {#if purpose === 'reset'}
      <p>{t('enlace.restablecer.siguiente')}</p>
      <div class="actions">
        <a class="button button-primary" href={resolve('forgot-password')}
          >{t('enlace.boton.nuevo')}</a
        >
      </div>
    {:else if emailVerified === false}
      <p>{t('enlace.verificar.sesion_sin_confirmar')}</p>
      <form method="POST" action="/account?/resendVerification">
        <div class="actions">
          <button type="submit" class="button button-primary">{t('correo.boton.reenviar')}</button>
        </div>
      </form>
    {:else if emailVerified === true}
      <p>{t('enlace.verificar.sesion_confirmado')}</p>
      <p><a class="block-link" href={resolve('account')}>{t('enlace.enlace.cuenta')}</a></p>
    {:else}
      <p>{t('enlace.verificar.sin_sesion')}</p>
      <p>
        <a class="block-link" href={withSuffix(resolve('login'), '?next=/account')}
          >{t('comun.nav.entrar')}</a
        >
      </p>
      <p>
        <a class="block-link" href={resolve('forgot-password')}>{t('entrar.enlace.olvido')}</a>
      </p>
    {/if}
  {/if}
</div>
