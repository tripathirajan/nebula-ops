import { logContextFromActiveSpan } from '@nebula-ops/otel-core';

/**
 * Returns a function suitable for pino's `mixin` option
 * (`pino({ mixin: createPinoMixin() })`) — Pattern A correlation-only logging
 * (docs/concepts/04-logging-integration.md §4.1/§4.5): every log line gets
 * `trace_id`/`span_id`/`trace_flags` merged in from whatever span is active at the
 * moment the log call happens, sourced from `otel-core`'s
 * `logContextFromActiveSpan` (fails safe/empty — `{}` — when no span is active,
 * never throws).
 *
 * No dependency on the `pino` package itself, at runtime or in types — pino's
 * `mixin` option accepts any `() => Record<string, unknown>`, so this function
 * needs nothing pino-specific to satisfy it. This is why `pino` is an optional
 * peer dependency `otel-node` never has to conditionally/lazily load.
 */
export function createPinoMixin(): () => Record<string, unknown> {
  return () => {
    const logContext = logContextFromActiveSpan();
    if (logContext.traceId === undefined) return {};
    return {
      trace_id: logContext.traceId,
      span_id: logContext.spanId,
      trace_flags: logContext.traceFlags,
    };
  };
}
