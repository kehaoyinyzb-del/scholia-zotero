import javascript from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', '.zotero-dev/**', '.logs/**', 'node_modules/**'] },
  javascript.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        Zotero: 'readonly',
        ChromeUtils: 'readonly',
        Services: 'readonly',
        IOUtils: 'readonly',
        PathUtils: 'readonly',
        Components: 'readonly',
        Cc: 'readonly',
        Ci: 'readonly',
        chrome: 'readonly',
        browser: 'readonly',
      },
    },
    rules: {
      'max-len': ['error', { code: 100, ignoreUrls: true }],
      'max-statements-per-line': ['error', { max: 1 }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-var': 'error',
      'prefer-const': 'error',
      // Sanitized provider errors must not retain secret-bearing causes.
      'preserve-caught-error': 'off',
    },
  },
  {
    files: ['addon/bootstrap.js', 'e2e/bootstrap.js'],
    languageOptions: { sourceType: 'script', globals: { acceptanceConfig: 'readonly' } },
    rules: { 'no-unused-vars': 'off', 'no-var': 'off' },
  },
];
