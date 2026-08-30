import { trace, context } from '@opentelemetry/api';
import { stripUndefined } from '../internal/object-utils.js';
import type { LogContext } from './types.js';

/**
 * Reads the currently active span (if any) via the standard OTel `context`/`trace`
 * API and formats its `SpanContext` into a `LogContext`. Returns `{}` — not an
 * error, not `undefined` — when there's no active span, matching the
 * fail-safe-empty behavior documented in
 * docs/concepts/04-logging-integration.md §4.4. This function is what `otel-node`'s
 * pino mixin / winston format and `otel-web`'s console bridge call on every log
 * line (docs/concepts/04-logging-integration.md §4.5–§4.7).
 */
export function logContextFromActiveSpan(): LogContext {
  const span = trace.getSpan(context.active());
  if (!span) return {};

  const spanContext = span.spanContext();
  return stripUndefined({
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    traceFlags: spanContext.traceFlags,
  });
}
