import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import html from '@html-eslint/eslint-plugin';
import prettier from 'eslint-config-prettier';
import vue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    'dist/**',
    '**/dist/**',
    '.build-cache/**',
    'build/**',
    '**/rendered/**',
    'integrations/companion/*/main.js',
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
      'tooling/ui-portability/*.test.mjs',
      'tooling/static-fixtures/*.test.mjs',
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
    files: [
      'tooling/ui-portability/src/**/*.ts',
      'tooling/static-fixtures/src/**/*.ts',
      'tooling/ui-catalog/**/*.ts',
      'packages/ui/**/*.ts',
    ],
    extends: [ts.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['**/*.vue'],
    extends: [ts.configs.recommendedTypeChecked, vue.configs['flat/recommended']],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: ts.parser,
        projectService: true,
        extraFileExtensions: ['.vue'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: { 'vue/multi-word-component-names': 'error' },
  },
  {
    files: [
      '**/*.vue',
      'tooling/ui-portability/src/**/*.ts',
      'tooling/static-fixtures/src/**/*.ts',
      'tooling/ui-catalog/**/*.ts',
      'packages/ui/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSAsExpression',
          message: 'Validate the boundary or correct the type instead of asserting it.',
        },
        {
          selector: 'TSTypeAssertion',
          message: 'Type assertions require an explicit documented exception.',
        },
        { selector: 'TSNonNullExpression', message: 'Narrow nullable values with a guard.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@maseaaao/*/src/*', '**/packages/*/src/**', '**/apps/*/src/**'],
              message: 'Use workspace exports; do not import another product internals.',
            },
          ],
        },
      ],
    },
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
