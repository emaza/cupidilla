<script lang="ts">
  import { RECENT_AUTH_MAX_AGE_MINUTES, type OAuthProvider } from '@cupidilla/contracts';
  import { fill, t, type TextKey } from '#lib/texts.ts';
  import ProviderButtons from './ProviderButtons.svelte';

  /**
   * Bloque «Confirma que eres tú» (UX §3.5.2): solo para cuentas sin contraseña (decisión 20),
   * con la sesión antigua, en lugar de la acción protegida. Un botón por cada proveedor unido.
   */
  interface Props {
    action: TextKey;
    providers: readonly OAuthProvider[];
    /** Página a la que volver tras confirmar. */
    next: '/account' | '/account/password';
  }

  let { action, providers, next }: Props = $props();
</script>

<section class="section confirm-identity" aria-labelledby="confirm-identity-title">
  <h2 id="confirm-identity-title">{t('verificar.titulo')}</h2>
  <p>
    {fill('verificar.texto', {
      accion: t(action),
      minutos: String(RECENT_AUTH_MAX_AGE_MINUTES),
    })}
  </p>
  <ProviderButtons {providers} from="account" intent="reauthenticate" {next} />
</section>
