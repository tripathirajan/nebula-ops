---
'@nebula-ops/otel-fastify': minor
---

Initial implementation of `@nebula-ops/otel-fastify`: a Fastify plugin
(`fastify.register(otelFastifyPlugin, options)`) built on `@nebula-ops/otel-node`.

Enriches the currently active span (created by `@opentelemetry/instrumentation-http`
via `otel-node`'s default instrumentation set) with the matched Fastify route
pattern — `http.route` attribute plus a `"<METHOD> <route>"` span rename — instead
of the generic method-only name auto-instrumentation alone produces. Automatically
records uncaught route errors as exception events with `ERROR` status via Fastify's
`onError` hook. Both are configurable per-route via `ignoreRoutes` and independently
toggleable via `captureRoutePattern`/`captureErrors`.

Also exports `otelFastifyLoggerOptions()` — a `{ mixin: createPinoMixin() }` helper
for Fastify's own `logger` constructor option, since pino's `mixin` can only be set
at logger construction time (verified: `Logger#child()` has no per-child override),
which happens before any plugin registers — this is documented explicitly as a real
constraint the plugin itself cannot route around, not silently glossed over.

Deliberately does not depend on or require `@opentelemetry/instrumentation-fastify`
(the official require-hook-based instrumentation) — using it would reintroduce the
"must be listed in the Node preload's instrumentations array" requirement this
package exists specifically to avoid, since Fastify's own `onRequest`/`onError`
hooks run at request time, not import time.

100% test coverage (25 tests), including a real Fastify instance via `.inject()`
with a genuinely active span (not mocked) to verify route-pattern/error-capture
behavior end-to-end, not just the underlying hook functions in isolation.
