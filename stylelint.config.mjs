export default {
  extends: ['stylelint-config-standard'],
  ignoreFiles: [
    '**/node_modules/**',
    'dist/**',
    '**/dist/**',
    '.build-cache/**',
    'build/**',
    '**/rendered/**',
    'tests/**',
  ],
  overrides: [{ files: ['**/*.html'], customSyntax: 'postcss-html' }],
  rules: {
    // Component/state selectors intentionally override earlier base selectors.
    'no-descending-specificity': null,
    // Cascade overrides are intentional; selectors may recur without duplicate declarations.
    'no-duplicate-selectors': null,
    'rule-empty-line-before': null,
    'declaration-empty-line-before': null,
    'import-notation': 'string',
    'value-keyword-case': ['lower', { ignoreKeywords: ['Arial', 'Unbounded'] }],
    'selector-class-pattern': null,
    'custom-property-pattern': null,
    'keyframes-name-pattern': null,
  },
};
