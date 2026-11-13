<script lang="ts">
  import { asset } from '$app/paths';
  import type { OAuthProvider } from '@cupidilla/contracts';

  /**
   * Logos de marca servidos por Cupidilla, sin peticiones a terceros (UX §3.1.2). Decorativos:
   * el nombre accesible es el texto del botón. Antes de publicar, contrastarlos con los archivos
   * oficiales de Google y del Brand Resource Center de Meta.
   */
  let { provider }: { provider: OAuthProvider } = $props();
</script>

<img class="provider-logo" src={asset(`logos/${provider}.svg`)} alt="" width="18" height="18" />
