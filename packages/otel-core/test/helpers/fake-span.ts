import type { Span, SpanContext } from '@opentelemetry/api';
import { TraceFlags } from '@opentelemetry/api';

/**
 * A minimal test double satisfying just enough of the `Span` interface for
 * `trace.getSpan(...).spanContext()` to work — otel-core's own code never calls
 * anything else on a `Span`, so the rest of the interface is deliberately not
 * implemented (cast through `unknown`, standard for a narrow test double).
 */
export function createFakeSpan(spanContext: Partial<SpanContext> = {}): Span {
  const resolved: SpanContext = {
    traceId: spanContext.traceId ?? '4bf92f3577b34da6a3ce929d0e0e4736',
    spanId: spanContext.spanId ?? '00f067aa0ba902b7',
    traceFlags: spanContext.traceFlags ?? TraceFlags.SAMPLED,
    ...(spanContext.traceState !== undefined ? { traceState: spanContext.traceState } : {}),
  };
  return {
    spanContext: () => resolved,
  } as unknown as Span;
}
