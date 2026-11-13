<script lang="ts">
  import { enhance } from '$app/forms';
  import { RECENT_AUTH_MAX_AGE_MINUTES, type OAuthProvider } from '@cupidilla/contracts';
  import { createSubmission } from '#lib/forms/submission.svelte.ts';
  import { fill, t, type TextKey } from '#lib/texts.ts';
  import PasswordField from './PasswordField.svelte';
  import ProviderButtons from './ProviderButtons.svelte';
  import SubmitButton from './SubmitButton.svelte';

  /**
   * Bloque «Confirma que eres tú» (UX §3.5.2): con la sesión antigua, en lugar de la acción
   * protegida. Un botón por cada proveedor unido y, si la cuenta tiene contraseña y ningún
   * proveedor, la contraseña (acción `?/reauthenticate` de la misma página).
   */
  interface Props {
    action: TextKey;
    providers: readonly OAuthProvider[];
    hasPassword: boolean;
    /** Página a la que volver tras confirmar. */
    next: '/account' | '/account/password' | '/account/delete';
    passwordError?: string;
  }

  let { action, providers, hasPassword, next, passwordError }: Props = $props();

  const submission = createSubmission();
</script>

<section class="section confirm-identity" aria-labelledby="confirm-identity-title">
  <h2 id="confirm-identity-title">{t('verificar.titulo')}</h2>
  <p>
    {fill('verificar.texto', {
      accion: t(action),
      minutos: String(RECENT_AUTH_MAX_AGE_MINUTES),
    })}
  </p>

  {#if providers.length > 0}
    <ProviderButtons {providers} from="account" intent="reauthenticate" {next} />
  {:else if hasPassword}
    <form method="POST" action="?/reauthenticate" novalidate use:enhance={submission.submit}>
      <PasswordField
        label={t('verificar.campo.contrasena')}
        autocomplete="current-password"
        error={passwordError}
      />
      <div class="actions">
        <SubmitButton
          label={t('verificar.boton.contrasena')}
          sendingLabel={t('verificar.boton.confirmando')}
          sending={submission.sending}
        />
      </div>
    </form>
  {/if}
</section>
