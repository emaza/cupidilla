<script lang="ts">
  import { resolve } from '$app/paths';
  import Terms from '#lib/legal/terms-2026-11-borrador.svelte';
  import { t } from '#lib/texts.ts';
</script>

<!-- El <title>, el aviso de borrador y la versión los pone el propio texto legal. -->
<Terms />

<p><a class="enlace-bloque" href={resolve('')}>{t('comun.boton.volver_inicio')}</a></p>
