import { browser } from '$app/env';
import { t } from '#lib/texts.ts';

let loading: Promise<void> | undefined;

/**
 * Carga el widget de ALTCHA en el navegador, una sola vez y antes de crear ningún
 * `<altcha-widget>` (técnico de captcha §8.2, A12, A13). `altcha/external` con su *worker* de
 * PBKDF2 como archivo aparte (sin `blob:`, para la CSP), los textos de UX con tuteo y sin nada de
 * terceros: ni firma de interacción, ni pie, ni logotipo con enlace a altcha.org.
 */
export function loadWidget(): Promise<void> {
  // `import.meta.env.SSR` es una constante de Vite: en el paquete del servidor todo lo de abajo se
  // elimina y no arrastra el widget ni su worker (R-CA9). `browser`, por si acaso fuera de Vite.
  if (import.meta.env.SSR || !browser) return Promise.resolve();
  loading ??= load().catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

async function load(): Promise<void> {
  await import('altcha/external');
  await import('altcha/altcha.css');
  await import('altcha/i18n/es-es');
  const { default: Pbkdf2Worker } = await import('altcha/workers/pbkdf2?worker');
  // Solo PBKDF2/SHA-256: un reto con otro algoritmo da error en el widget (y la API no lo acepta).
  $altcha.algorithms.set('PBKDF2/SHA-256', () => new Pbkdf2Worker());
  $altcha.i18n.set('es-es', {
    ...$altcha.i18n.get('es-es'),
    label: t('captcha.widget.etiqueta'),
    verifying: t('captcha.widget.comprobando'),
    waitAlert: t('captcha.widget.comprobando'),
    verified: t('captcha.widget.comprobado'),
    error: t('captcha.widget.error'),
    expired: t('captcha.widget.caducado'),
    verificationRequired: t('captcha.widget.requerida'),
  });
  $altcha.defaults.set({
    humanInteractionSignature: false,
    hideFooter: true,
    hideLogo: true,
    disableAutoFocus: true,
  });
}
