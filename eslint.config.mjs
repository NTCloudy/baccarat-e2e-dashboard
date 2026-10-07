// @ts-check
// Lint rules for the whole repository (run with `npm run lint`):
// - TypeScript (tests, page objects, Playwright configs): type-aware rules, so a
//   missing `await` on a Playwright call is an error (@typescript-eslint/no-floating-promises).
// - Tests and page objects: eslint-plugin-playwright's recommended rules
//   (no fixed waits, no page.pause, web-first assertions, ...).
// - App UI, Dashboard (browser) and App/Scripts (Node.js): ESLint's recommended JavaScript rules.
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import playwright from 'eslint-plugin-playwright';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['test-output/', 'playwright-report/', 'test-results/', '_site/', 'results-branch/']),
  js.configs.recommended,
  {
    files: ['app/**/*.mjs', 'scripts/**/*.mjs', 'shared/**/*.mjs', '*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['app/public/**/*.js', 'dashboard/**/*.js'],
    languageOptions: { sourceType: 'module', globals: globals.browser },
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['tests/**/*.ts', 'src/**/*.ts', 'dashboard-tests/**/*.ts'],
    extends: [playwright.configs['flat/recommended']],
    rules: {
      'playwright/expect-expect': ['warn', { assertFunctionPatterns: ['^(verify|expect)[A-Z]'] }],
    },
  },
]);
