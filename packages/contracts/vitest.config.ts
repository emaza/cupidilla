import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // Rutas relativas a la raíz del repo, para que SonarQube resuelva el lcov.
      reporter: ['text-summary', ['lcov', { projectRoot: '../..' }]],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts'],
    },
  },
});
