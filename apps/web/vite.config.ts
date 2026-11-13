import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

/**
 * `form-action` (técnico §12.4): los botones de proveedor son POST que responden 303 a otro
 * origen, y Chrome aplica `form-action` también a esa redirección. El proveedor falso solo se
 * añade si `OAUTH_FAKE_PROVIDER_URL` está definida al compilar (e2e y `dev` con el falso); la
 * compilación de producción no la tiene.
 */
/** Origen `esquema://host[:puerto]` con al menos un punto, como exige `Csp.HostSource`. */
type HostSource = `${string}://${string}.${string}`;
const fakeProvider = process.env.OAUTH_FAKE_PROVIDER_URL;
const formAction: ['self', ...HostSource[]] = [
  'self',
  'https://accounts.google.com',
  'https://www.facebook.com',
  'https://m.facebook.com',
  ...(fakeProvider && URL.canParse(fakeProvider)
    ? [new URL(fakeProvider).origin as HostSource]
    : []),
];

export default defineConfig({
  plugins: [
    sveltekit({
      compilerOptions: {
        // Fuerza el modo runas en todo el proyecto, salvo en las bibliotecas.
        runes: ({ filename }) =>
          filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
      },
      adapter: adapter(),
      // Un único .env en la raíz del monorepo (§11.2 del diseño técnico).
      env: { dir: '../..' },
      // La protección CSRF de SvelteKit está siempre activa; no se confía en ningún otro origen.
      csrf: { trustedOrigins: [] },
      csp: {
        mode: 'auto',
        directives: {
          'default-src': ['self'],
          'script-src': ['self'],
          'style-src': ['self', 'unsafe-inline'],
          'img-src': ['self', 'data:'],
          'font-src': ['self'],
          'connect-src': ['self'],
          'form-action': formAction,
          'frame-ancestors': ['none'],
          'base-uri': ['self'],
          'object-src': ['none'],
        },
      },
    }),
  ],
  test: {
    expect: { requireAssertions: true },
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          // Más los unitarios de los helpers de e2e (Playwright solo recoge `*.e2e.ts`).
          include: ['src/**/*.{test,spec}.{js,ts}', 'tests/e2e/helpers/**/*.spec.ts'],
          exclude: ['src/**/*.svelte.{test,spec}.{js,ts}'],
        },
      },
    ],
  },
});
