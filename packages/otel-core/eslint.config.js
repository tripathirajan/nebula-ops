// otel-core must have zero Node-only or browser-only imports (CLAUDE.md's
// non-negotiable rules; docs/architecture.md §4; docs/concepts/07 §7.5). This is
// the mechanical, per-package half of that guarantee — the other half is
// scripts/verify-otel-core-browser-safe.mjs's bundler-level smoke build, run in CI.
import rootConfig from '../../eslint.config.js';

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...rootConfig,
  {
    // Tests run under Node (vitest) and are explicitly exempt from the
    // environment-agnostic restriction below — it applies to src/ (what ships to
    // consumers), not test/ (this package's own test harness).
    files: ['test/**/*.ts'],
    languageOptions: {
      globals: {
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            'fs',
            'http',
            'https',
            'net',
            'tls',
            'os',
            'path',
            'child_process',
            'async_hooks',
            'worker_threads',
            'cluster',
            'dgram',
            'dns',
          ],
          patterns: ['node:*'],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'otel-core must be environment-agnostic — no browser globals.' },
        {
          name: 'document',
          message: 'otel-core must be environment-agnostic — no browser globals.',
        },
        {
          name: 'process',
          message:
            'otel-core must be environment-agnostic — no Node globals. Callers pass values in via ConfigSource instead.',
        },
      ],
    },
  },
];
