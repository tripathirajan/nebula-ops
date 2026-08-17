// Node globals otel-node's src/ and test/ files are allowed to use (unlike
// otel-core, which blocks these — see packages/otel-core/eslint.config.js).
export default {
  process: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  Buffer: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
};
