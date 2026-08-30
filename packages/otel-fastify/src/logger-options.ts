import { createPinoMixin } from '@nebula-ops/otel-node';

/**
 * Returns `{ mixin: createPinoMixin() }` — pass it into Fastify's own `logger`
 * constructor option (`fastify({ logger: otelFastifyLoggerOptions() })`), **not**
 * into `otelFastifyPlugin`. This is a real, unavoidable constraint, not an
 * oversight: pino's `mixin` can only be set when a logger is *constructed*
 * (`pino({ mixin })`), and Fastify constructs its own root logger internally
 * inside the `fastify()` factory call — before any plugin (including
 * `otelFastifyPlugin`) has a chance to register. `Logger#child()`'s options don't
 * accept a `mixin` override either, so there's no way to retrofit this from a
 * plugin after the fact. See this package's Non-goals for the full explanation.
 *
 * Once set this way, every log call through `request.log` (Fastify's built-in
 * per-request child logger) — and any further `.child()` of it — automatically
 * picks up whatever span is active *at the moment each individual log line is
 * written*, exactly like `otel-node`'s own pino integration
 * (docs/concepts/04-logging-integration.md §4.1/§4.5), with zero other code
 * changes anywhere in route handlers.
 */
export function otelFastifyLoggerOptions(): { mixin: () => Record<string, unknown> } {
  return { mixin: createPinoMixin() };
}
