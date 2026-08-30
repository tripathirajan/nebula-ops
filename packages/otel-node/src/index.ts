// Public export barrel for @nebula-ops/otel-node. This is the frozen surface from
// docs/package-specs/otel-node.md — every export here must have a matching entry
// there, and vice versa (see .claude/agents/otel-spec-reviewer.md).

export { startNodeSdk, type NodeSdkOptions } from './sdk/start.js';
export { shutdownNodeSdk, registerShutdownHandlers } from './sdk/shutdown.js';

export { createPinoMixin } from './logging/pino-mixin.js';
export { createWinstonFormat } from './logging/winston-format.js';

// Convenience re-exports — deliberately the API package's own exports, unmodified
// (docs/concepts/07-generic-reusable-design.md §7.3), so application code written
// against "the OTel API" isn't secretly locked into a wrapper-specific dialect.
export { trace, context, metrics, SpanStatusCode, SpanKind } from '@opentelemetry/api';

export { OTEL_NODE_VERSION } from './version.js';
