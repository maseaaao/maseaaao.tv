import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import html from '@html-eslint/eslint-plugin';
import prettier from 'eslint-config-prettier';

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    'dist/**',
    '**/dist/**',
    '.build-cache/**',
    'build/**',
    '**/rendered/**',
  ]),
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  {
    files: [
      '*.{js,mjs,cjs}',
      'tooling/**/*.{js,mjs,cjs}',
      'packages/**/*.{js,mjs,cjs}',
      'integrations/**/*.{js,mjs,cjs}',
      'tests/**/*.mjs',
      'apps/*/*.{js,mjs,cjs}',
      'apps/*/scripts/*.mjs',
      'apps/*/tests/**/*.mjs',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/**/src/**/*.js', 'artwork/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  // Test callbacks are serialized into browser contexts by Playwright.
  {
    files: [
      'tests/**/*.mjs',
      'apps/stream-info/scripts/verify*-live.mjs',
      'apps/stream-info/scripts/verify-live.mjs',
      'tooling/artwork/*.mjs',
    ],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['apps/stream-info/src/**/*.ts', 'apps/stream-info/tests/**/*.ts'],
    extends: [ts.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/stream-info/*.ts'],
    extends: [ts.configs.recommended],
    languageOptions: { parserOptions: { projectService: false } },
  },
  {
    files: ['**/*.html'],
    plugins: { html },
    language: 'html/html',
    rules: {
      'html/require-lang': 'error',
      'html/require-doctype': 'error',
      'html/require-title': 'error',
      'html/require-img-alt': 'error',
      'html/no-duplicate-id': 'error',
      'html/no-duplicate-attrs': 'error',
      'html/no-nested-interactive': 'error',
      'html/no-positive-tabindex': 'error',
      'html/require-frame-title': 'error',
    },
  },
  // Provider HTML is an item template, not a document. Its outer document is owned by the service.
  {
    files: ['apps/obs-widgets/src/streamlabs-chat/*.html'],
    rules: {
      'html/require-lang': 'off',
      'html/require-doctype': 'off',
      'html/require-title': 'off',
    },
  },
  prettier,
]);
