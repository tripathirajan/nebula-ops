/**
 * A snapshot of trace-correlation data suitable for attaching to a log line. This is
 * the frozen public shape from docs/package-specs/otel-core.md — every field is
 * optional because a `LogContext` read outside any active span (or before any
 * `ContextManager` is installed) is legitimately empty, not an error (see
 * docs/concepts/04-logging-integration.md §4.4: correlation fails safe/empty, never
 * wrong).
 */
export interface LogContext {
  traceId?: string;
  spanId?: string;
  traceFlags?: number;
  attributes?: Record<string, unknown>;
}
