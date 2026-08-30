// otel-node is Node-only, but must never depend on otel-web, directly or
// transitively (CLAUDE.md's non-negotiable rules; docs/architecture.md §1/§8.4 of
// the concepts primer). This is the mechanical enforcement of that specific rule —
// otel-core's own eslint.config.js enforces the opposite-direction (environment-
// agnostic) constraint.
import rootConfig from '../../eslint.config.js';
import globals from './eslint-globals.js';

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...rootConfig,
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      globals,
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@nebula-ops/otel-web',
              message:
                'otel-node must never depend on otel-web (CLAUDE.md non-negotiable rules). If you need shared logic, it belongs in otel-core.',
            },
          ],
          patterns: [
            {
              group: ['@nebula-ops/otel-web/*'],
              message:
                'otel-node must never depend on otel-web (CLAUDE.md non-negotiable rules). If you need shared logic, it belongs in otel-core.',
            },
          ],
        },
      ],
    },
  },
];
