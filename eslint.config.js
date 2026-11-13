import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/node_modules',
    '**/dist',
    '**/build',
    '**/.svelte-kit',
    '**/coverage',
    '**/playwright-report',
    '**/test-results',
    'apps/api/drizzle/meta',
  ]),
  js.configs.recommended,
  ts.configs.recommended,
  svelte.configs.recommended,
  prettier,
  svelte.configs.prettier,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // typescript-eslint desaconseja no-undef en proyectos TypeScript: ya lo comprueba el compilador.
      'no-undef': 'off',
    },
  },
  {
    // Lint con tipos en todo el TypeScript del monorepo.
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        parser: ts.parser,
      },
    },
  },
  {
    // En la API todo se registra con el Logger de Nest (reglas de §8.9 del diseño técnico).
    files: ['apps/api/src/**'],
    rules: { 'no-console': 'error' },
  },
  {
    // Las transacciones se abren con Transactions.run, nunca con db.transaction de Drizzle (§7.2).
    files: ['apps/api/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='transaction']",
          message:
            'Usa Transactions.run (apps/api/src/database/transactions.ts), no db.transaction.',
        },
      ],
    },
  },
  {
    // La web no toca la base de datos ni las contraseñas.
    files: ['apps/web/src/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'pg', message: 'La web no accede a la base de datos.' },
            { name: 'drizzle-orm', message: 'La web no accede a la base de datos.' },
            { name: 'argon2', message: 'Las contraseñas solo se tratan en la API.' },
          ],
          patterns: [{ group: ['drizzle-orm/*'], message: 'La web no accede a la base de datos.' }],
        },
      ],
    },
  },
);
