import js from '@eslint/js';

const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  queueMicrotask: 'readonly',
  AbortController: 'readonly',
  URL: 'readonly',
  structuredClone: 'readonly',
  fetch: 'readonly'
};

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  history: 'readonly',
  fetch: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  queueMicrotask: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  IntersectionObserver: 'readonly',
  MutationObserver: 'readonly',
  ResizeObserver: 'readonly',
  CustomEvent: 'readonly',
  Event: 'readonly',
  FormData: 'readonly',
  AbortController: 'readonly',
  CSS: 'readonly',
  getComputedStyle: 'readonly',
  URL: 'readonly',
  structuredClone: 'readonly',
  crypto: 'readonly',
  matchMedia: 'readonly'
};

const testGlobals = {
  ...nodeGlobals,
  ...browserGlobals
};

/**
 * Minimal, high-signal ruleset: catch real bugs (unused/undefined vars,
 * unreachable code, broken control flow), not style. This repo has no
 * Prettier and no reason to add one for this pass.
 */
const rules = {
  ...js.configs.recommended.rules,
  'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
  'no-empty': ['error', { allowEmptyCatch: true }],
  // Playwright's fixture callbacks are conventionally written `({}, testInfo) => ...`
  // to skip an unused fixture destructure — that's deliberate, not a mistake.
  'no-empty-pattern': 'off'
};

export default [
  {
    ignores: ['node_modules/**', '.data/**', 'playwright-report/**', 'test-results/**', 'blob-report/**', 'tests/e2e/visual.spec.mjs-snapshots/**']
  },
  {
    files: ['api/**/*.js', 'lib/server/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: nodeGlobals
    },
    rules
  },
  {
    files: ['public/src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: browserGlobals
    },
    rules
  },
  {
    files: ['tests/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: testGlobals
    },
    rules
  },
  {
    files: ['eslint.config.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: nodeGlobals
    },
    rules
  }
];
