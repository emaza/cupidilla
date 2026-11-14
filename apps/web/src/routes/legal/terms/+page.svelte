<script lang="ts">
  import { resolve } from '$app/paths';
  import Terms from '#lib/legal/terms-2026-11-borrador-2.svelte';
  import { t } from '#lib/texts.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<!-- El <title>, el aviso de borrador y la versión los pone el propio texto legal. -->
<Terms minAge={data.minAge} />

<p><a class="block-link" href={resolve('')}>{t('comun.boton.volver_inicio')}</a></p>
