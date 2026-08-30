// otel-fastify is Node-only, built on otel-node — no additional dependency-graph
// restriction needed beyond the root config (unlike otel-node's own "never import
// otel-web" rule, which doesn't apply here since otel-fastify has no reason to ever
// touch otel-web).
import rootConfig from '../../eslint.config.js';

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...rootConfig,
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
  },
];
