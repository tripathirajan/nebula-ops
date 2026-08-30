// Public export barrel for @nebula-ops/otel-fastify. This is the frozen surface
// from docs/package-specs/otel-fastify.md — every export here must have a matching
// entry there, and vice versa.

export { otelFastifyPlugin, type OtelFastifyOptions } from './plugin.js';
export { default } from './plugin.js';
export { otelFastifyLoggerOptions } from './logger-options.js';
export { OTEL_FASTIFY_VERSION } from './version.js';
