import { trace, context, SpanStatusCode } from '@nebula-ops/otel-node';

/**
 * Records an uncaught route error as an exception event on the currently active
 * span and marks it as an error — the `recordException` + `setStatus` pairing
 * documented in docs/concepts/02-otel-node.md §2.4 (recording the exception alone
 * does not mark the span as an error; both calls are needed). Runs as an `onError`
 * hook, which Fastify calls for any error that propagates out of a route handler
 * or an earlier hook — this is what lets consumers get error-recorded spans for
 * every route without wrapping each handler's body in a try/catch themselves.
 *
 * Does nothing (silently) if no span is active, for the same reason documented in
 * `route-pattern.ts`.
 */
export function applyErrorCapture(error: Error): void {
  const span = trace.getSpan(context.active());
  if (!span) return;

  span.recordException(error);
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
}
