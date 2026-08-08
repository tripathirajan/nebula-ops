# 3. OpenTelemetry for the browser

## 3.1 Why this is a genuinely different problem than Node

Node's story (§2) is "patch modules, use AsyncLocalStorage, export to a Collector
that's reachable on the network." The browser has none of those load-bearing pieces
for free:

- No `require`/module-cache to monkey-patch — browser instrumentation wraps
  **global objects** instead (`window.fetch`, `XMLHttpRequest.prototype`).
- No `AsyncLocalStorage` — the browser needs a different mechanism to track "active
  span" across promises/callbacks (§3.3).
- The exporter target (a Collector or backend) is a **cross-origin network
  destination reachable from the end user's browser**, not a same-datacenter
  service — this brings CORS, payload-size, and endpoint-exposure concerns that don't
  exist in Node.
- The runtime is **untrusted and highly variable** (ad blockers, browser extensions,
  varying JS engine versions, users on slow/flaky networks) in a way a controlled
  server fleet isn't.

## 3.2 The moving pieces

1. A **Resource** — same concept as Node, but browser-appropriate values
   (`browser.*` attributes are limited/best-effort; there's no reliable "host" the way
   a server has one).
2. A **WebTracerProvider** (`@opentelemetry/sdk-trace-web`), with SpanProcessors
   feeding a SpanExporter (typically OTLP/HTTP — gRPC isn't available from a browser).
3. **Instrumentations**: `FetchInstrumentation`, `XMLHttpRequestInstrumentation`,
   `DocumentLoadInstrumentation` (captures navigation/resource timing as spans),
   optionally `UserInteractionInstrumentation` (clicks) — all from
   `@opentelemetry/instrumentation-*` browser-targeted packages.
4. A **ContextManager** appropriate for the browser (§3.3).
5. A **Propagator** — same W3C Trace Context concept as Node, but with an important
   extra config knob: which origins are allowed to *receive* trace headers at all
   (§3.4).

There is no browser equivalent of `NodeSDK`'s single assembling class in wide use —
browser setup is typically done by hand with `WebTracerProvider` directly, which is
part of why this repo's `otel-web` package exists (see [`08-why-this-layer.md`](08-why-this-layer.md)).

## 3.3 Context propagation in the browser

Without `AsyncLocalStorage`, browser SDKs use one of:

- **`ZoneContextManager`** (`@opentelemetry/context-zone`, built on `zone.js`) —
  Zone.js monkey-patches async browser APIs (`setTimeout`, `Promise`, event
  listeners, XHR callbacks) to maintain an execution-zone concept, similar in spirit
  to `AsyncLocalStorage`. This is the most complete option but means shipping and
  initializing `zone.js`, which itself patches a lot of global behavior and can
  interact awkwardly with some frameworks (notably it needs care in Angular apps,
  which also use zone.js for change detection — version/instance conflicts are a
  known sharp edge).
- **`StackContextManager`** — a lighter-weight fallback that tracks context via a
  manual push/pop stack rather than patching globals. Works correctly for
  synchronous call chains and for the specific async patterns instrumentation
  libraries explicitly re-enter context around, but **will lose context across
  arbitrary user-written async code** that the SDK doesn't explicitly wrap (e.g. a
  plain `setTimeout` in application code, without going through an instrumented API).
  In practice this is the far more common choice: no extra dependency, no global
  monkey-patching, and the resulting gaps only affect spans the app would have had to
  create manually anyway.

This is a real, unavoidable trade-off (not a bug to fix): **the browser has no
built-in equivalent of AsyncLocalStorage**, so "always-correct automatic context
propagation" and "no global monkey-patching" are in tension, and different apps will
reasonably choose differently depending on whether they already tolerate zone.js
(e.g. because they're on Angular) or want to avoid it (most other frameworks).

## 3.4 CORS and cross-origin trace propagation

By default, browser instrumentation does **not** attach `traceparent`/`tracestate`
headers to every outgoing request — only to requests to origins explicitly
allow-listed via `propagateTraceHeaderCorsUrls` (a list of strings/RegExps). This
exists for two reasons:

1. **Security/privacy** — you don't want to leak your internal trace IDs (and
   whatever `tracestate` vendors stuff in there) to arbitrary third-party origins a
   page happens to call (analytics pixels, ad services, unrelated APIs).
2. **CORS preflight cost** — adding custom headers (`traceparent` counts as one) to a
   cross-origin request turns a simple request into one requiring an OPTIONS
   preflight, and the *target* server must explicitly allow `traceparent`/`tracestate`
   in its `Access-Control-Allow-Headers` response or the real request will be blocked
   by the browser. Turning this on for an origin you don't control (and that isn't
   configured to allow it) breaks the request rather than just failing to trace it.

Practically: only your own backend origins (and origins you know accept the header)
belong in that allow-list — the browser instrumentation's default-off posture here is
a deliberate safety choice, not a gap to work around globally.

## 3.5 Exporting from the browser

- **OTLP/HTTP only** in practice — no gRPC from browser JS (no HTTP/2 trailers
  access, no raw TCP). Payloads are protobuf or JSON over `fetch`/`XHR`/`sendBeacon`.
- **`sendBeacon` matters for reliability on page unload** — a normal `fetch` export
  triggered right as the user navigates away or closes the tab can be silently
  cancelled by the browser before the network request completes.
  `navigator.sendBeacon` is designed specifically to survive page unload, so
  exporters (or a `visibilitychange`/`pagehide` flush hook) commonly use it as the
  transport for a final flush.
- **The exporter endpoint is public-reachable by construction** — it's a URL the
  browser calls directly, unlike a Node service's Collector endpoint which usually
  sits inside a private network. This means the endpoint needs to be something safe
  to expose to any user of the app (rate-limited, no ability to submit telemetry that
  corrupts other tenants' data, no assumption of network-level trust) — a materially
  different security posture than the Node side.
- **Payload size / request volume budget** matters more here than server-side: every
  span/log a browser exports is real bytes over the end user's (possibly slow,
  possibly metered) connection, competing with the actual application's network
  usage. This is a bigger practical argument for aggressive sampling and batching
  (§5, §6) on the web side than on the Node side, where bandwidth is comparatively free.

## 3.6 web-vitals

Core Web Vitals (LCP, INP, CLS) and other performance metrics
(FCP, TTFB) are **not** something OpenTelemetry's own instrumentation captures —
they come from the separate `web-vitals` library (built on browser
`PerformanceObserver` APIs), which reports metrics via callback once each value is
finalized (some, like CLS, can update multiple times during a page's life and settle
on a final value at `visibilitychange`/unload). "Bridging" web-vitals into OTel means
subscribing to those callbacks and recording each result as a span, span event, or
OTel metric — there's no native web-vitals-to-OTel integration upstream, which is why
this is spec'd as an explicit `otel-web` responsibility rather than assumed to be free.

## 3.7 Document load and resource timing

`DocumentLoadInstrumentation` converts the browser's `PerformanceNavigationTiming`
and `PerformanceResourceTiming` APIs (DNS lookup, TCP connect, TLS, TTFB, DOM content
loaded, load event, and per-resource timing for scripts/styles/images/fetches) into
spans automatically on page load — this is usually the single richest source of
browser telemetry with zero manual instrumentation, and is typically the first span
tree a user's trace-viewer session shows.
