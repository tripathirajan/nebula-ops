// Public export barrel for @nebula-ops/otel-core. This is the frozen surface from
// docs/package-specs/otel-core.md — every export here must have a matching entry
// there, and vice versa (see .claude/agents/otel-spec-reviewer.md, which checks
// exactly this). No implementation lives directly in this file.

export type { OtelConfig } from './config/schema.js';
export { validateConfig } from './config/schema.js';
export { resolveConfig, type ConfigSource } from './config/resolve.js';
export { ConfigError, type ConfigIssue } from './config/errors.js';

export { buildResource } from './resource/build-resource.js';
export { OtelAttributes } from './attributes/otel-attributes.js';

export type { LogContext } from './context/types.js';
export { getActiveLogContext, runWithLogContext, bindLogContext } from './context/log-context.js';
export { logContextFromActiveSpan } from './context/from-span.js';

export { OTEL_CORE_VERSION } from './version.js';
