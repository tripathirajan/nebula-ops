# Package spec: `@nebula-ops/otel-fastify`

## Purpose

`otel-fastify` is a Fastify plugin adding Fastify-specific request/route
observability on top of the Node-level tracing `@nebula-ops/otel-node`'s
`startNodeSdk()` already provides. Registering it once —
`fastify.register(otelFastifyPlugin, options)` — is the only code change needed
anywhere else in a Fastify app for: enriching the active span with the matched
route pattern (not the raw URL) via the standard `http.route` attribute, and
automatically recording uncaught route errors as span exception events. Built on
`@nebula-ops/otel-node` (not `otel-core` directly) — see
[ADR: use otel-node as base](#why-otel-node-as-the-base-not-otel-core) below.

**Honest scope, read before using this package (see Non-goals for the full
reasoning):** this plugin does **not** replace `otel-node`'s SDK bootstrap — that
stays a separate `--require`/`--import` preload step, unavoidably, per
[concepts ch. 2 §2.1](../concepts/02-otel-node.md#21-minimal-bootstrap-annotated).
It also does **not** achieve request-logger trace correlation purely by being
registered — `pino`'s `mixin` option can only be set when a logger is
_constructed_, which for Fastify's own built-in logger happens inside the
`fastify()` factory call, before any plugin has a chance to register. That part
needs the separate `otelFastifyLoggerOptions()` helper passed into `fastify()`'s own
`logger` option. Both of these are real, verified technical constraints, not
scope-creep avoidance — see Non-goals.

### Why otel-node as the base, not otel-core

Fastify only exists in Node, and this package needs `createPinoMixin` and the
`trace`/`context`/`SpanStatusCode` re-exports `otel-node` already provides —
depending on `otel-node` directly (rather than duplicating that surface against
`otel-core`) keeps this package's own dependency footprint minimal and its behavior
consistent with whatever `otel-node` setup the same app already uses.

## Public exports

```ts
export interface OtelFastifyOptions {
  captureRoutePattern?: boolean; // default true — sets http.route, renames the active span to "<METHOD> <route>"
  captureErrors?: boolean; // default true — records uncaught route errors via Fastify's onError hook
  ignoreRoutes?: (string | RegExp)[]; // default [] — routes to skip entirely (matched against the route *pattern*)
}

export const otelFastifyPlugin: FastifyPluginAsync<OtelFastifyOptions>;
export default otelFastifyPlugin;

// Pass into fastify({ logger: otelFastifyLoggerOptions() }) at construction time —
// NOT into otelFastifyPlugin. See Purpose/Non-goals for why.
export function otelFastifyLoggerOptions(): { mixin: () => Record<string, unknown> };

export const OTEL_FASTIFY_VERSION: string;
```

## Internal modules

| Module                       | Responsibility                                                                                                                                                                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/plugin.ts`              | `otelFastifyPlugin` — wraps registration with `fastify-plugin` (so hooks apply at the root scope, not confined to an encapsulation context), registers the `onRequest`/`onError` hooks below, applies `ignoreRoutes` filtering before calling into either.                                           |
| `src/hooks/route-pattern.ts` | `applyRoutePattern` — reads the active span via `otel-node`'s `trace`/`context` re-exports, sets `http.route` (from `@opentelemetry/semantic-conventions`' `ATTR_HTTP_ROUTE`) and renames the span using Fastify's `request.routeOptions.url`. No-ops if there's no active span or no matched route. |
| `src/hooks/error-capture.ts` | `applyErrorCapture` — `recordException` + `setStatus(ERROR)` on the active span, the pairing documented in [concepts ch. 2 §2.4](../concepts/02-otel-node.md#24-custom-manual-instrumentation). No-ops if there's no active span.                                                                    |
| `src/matching.ts`            | `isIgnoredRoute` — exact-string or `RegExp#test` matching against a route pattern.                                                                                                                                                                                                                   |
| `src/logger-options.ts`      | `otelFastifyLoggerOptions` — thin wrapper around `otel-node`'s `createPinoMixin`, packaged for Fastify's `logger` constructor option specifically.                                                                                                                                                   |
| `src/index.ts`               | Public export barrel.                                                                                                                                                                                                                                                                                |

## External dependencies

| Package                               | Version range                          | Kind                                                                             |
| ------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------- |
| `@opentelemetry/api`                  | `^1.9.0`                               | `peerDependency` (+ `devDependency`)                                             |
| `@nebula-ops/otel-node`               | `workspace:*` → published semver range | `dependency`                                                                     |
| `@opentelemetry/semantic-conventions` | `^1.37.0`                              | `dependency` (for `ATTR_HTTP_ROUTE`, so `http.route` isn't a hand-typed literal) |
| `fastify`                             | `^5.0.0`                               | `peerDependency` (+ `devDependency`, pinned to `^5.12.1` for local build/test)   |
| `fastify-plugin`                      | `^6.0.0`                               | `dependency`                                                                     |

All versions verified against the live npm registry at implementation time (M2.5),
per the same practice documented in `otel-core.md`/`otel-node.md`'s version-correction
notes — no guessed pins here at all, since this package was written after that lesson.

## Non-goals

- Does not start or configure the `NodeSDK` — `otel-node`'s `startNodeSdk()`, loaded
  via the standard `--require`/`--import` preload step
  ([concepts ch. 2 §2.1](../concepts/02-otel-node.md#21-minimal-bootstrap-annotated)),
  remains required and unchanged. No Fastify plugin registered from _inside_ an
  already-running app can retroactively patch modules (`http`, etc.) that were
  already imported by the time it registers — this is a fundamental Node
  auto-instrumentation constraint, not a gap in this package.
- Does not itself bind trace/span id into `request.log` — verified during
  implementation that `pino`'s `Logger#child()` options have no per-child `mixin`
  override (only the root logger's own constructor accepts `mixin`), so this cannot
  be retrofitted from a plugin registered after `fastify()` has already constructed
  its logger. Use `otelFastifyLoggerOptions()` at `fastify()` construction time
  instead — see Public exports.
- Does not provide base HTTP-level span creation — relies on
  `@opentelemetry/instrumentation-http` (via `otel-node`'s default instrumentation
  set) already being active and having created the `SERVER` span this plugin
  enriches.
- Does not depend on or wrap `@opentelemetry/instrumentation-fastify` (the official
  require-hook-based Fastify instrumentation) — deliberately avoided, because using
  it would reintroduce exactly the "must be listed in the preload's
  `instrumentations` array" requirement this package exists specifically to avoid
  for its own feature set (route-pattern capture achieved instead via Fastify's own
  `onRequest`/`onError` hooks, which run at request time, not import time).
- Server-only — no browser or `otel-web` integration; Fastify doesn't run in a
  browser.
- Does not provide route-level manual-span helpers (e.g. a `useSpan`-equivalent) —
  application code creates its own spans via `otel-node`'s re-exported `trace`
  API directly, same as any other Node service.
