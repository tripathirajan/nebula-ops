# 2. OpenTelemetry for Node.js

## 2.1 The moving pieces

A Node process wanting full telemetry wires together:

1. A **Resource** (service name/version/environment/etc — §1.10).
2. A **TracerProvider** (`NodeTracerProvider`), with one or more **SpanProcessors**
   feeding one or more **SpanExporters**.
3. A **MeterProvider**, with a **MetricReader** feeding a **MetricExporter**.
4. A **LoggerProvider**, with **LogRecordProcessors** feeding **LogRecordExporters**
   (only if using the OTel Logs pipeline — see [`04-logging-integration.md`](04-logging-integration.md)
   for why this is often skipped in favor of a bridge).
5. A **ContextManager** — `AsyncLocalStorageContextManager`, so the "active span"
   concept survives across `await`, `.then()`, `setTimeout`, event emitters, etc.
6. **Instrumentations** — patches for `http`, `express`, `pg`, `mongodb`, `redis`,
   `grpc`, and dozens more.

`@opentelemetry/sdk-node`'s `NodeSDK` class exists specifically to assemble all of
this from one config object instead of wiring each piece by hand — it's the standard
entry point for Node services, not something most teams build from scratch. It calls
`.start()` once at process boot, before any instrumented module is `require`'d (this
ordering matters — see §2.3).

## 2.2 Auto-instrumentation via monkey-patching

Node instrumentation works by patching the module cache: `@opentelemetry/instrumentation`
uses `require-in-the-middle`/`import-in-the-middle` hooks to intercept a target
module's `exports` the moment it's loaded, and wraps specific functions (e.g.
`http.request`, `express`'s router methods) so calling them transparently starts/ends
spans around the original behavior. `@opentelemetry/auto-instrumentations-node` is a
meta-package bundling instrumentations for the most common Node libraries so you don't
hand-pick each one.

**Implication:** instrumentation must be registered *before* the target library is
first `require`'d/imported anywhere in the process — including transitively via other
imports. This is why `NodeSDK.start()` (or an equivalent `--require` preload script)
has to run at the very top of the process's entry point, ahead of any application
code that might import `express`/`pg`/etc. Getting this ordering wrong is the single
most common Node OTel setup bug (instrumentation silently produces no spans for a
library that was already loaded).

## 2.3 Context propagation in Node

`AsyncLocalStorage` (Node's built-in, since Node 12.17/13.10) is what
`AsyncLocalStorageContextManager` uses to make "active span" tracking work correctly
across `async`/`await`, Promises, and most callback-based async APIs without manual
plumbing. It's conceptually a per-async-execution-chain variable: entering
`asyncLocalStorage.run(context, fn)` makes `context` visible to everything `fn`
triggers, including nested async operations, until that chain completes.

Two practical gotchas worth knowing before wrapping this:

- **Not everything is automatically tracked.** Some non-standard async patterns
  (certain worker-thread message passing, some third-party event-emitter-based
  libraries, or manually detached callbacks) can lose the async chain that
  `AsyncLocalStorage` follows. Instrumentation for well-known libraries handles their
  own async patterns correctly; hand-written code doing unusual async plumbing may
  need to manually re-enter context (`context.with(ctx, fn)`).
- **Performance cost is small but non-zero.** `AsyncLocalStorage` adds overhead to
  every async operation in the process, not just instrumented ones, because Node's
  async hooks machinery tracks all async resources once any `AsyncLocalStorage` is in
  use. This has improved significantly across Node versions but is worth knowing when
  reasoning about baseline overhead (§6).

## 2.4 Exporters and the Node-specific transport question

Node SDKs commonly export via:
- **OTLP/gRPC** (`@opentelemetry/exporter-trace-otlp-grpc` and metric/log
  equivalents) — efficient binary protocol, needs an HTTP/2-capable network path
  (can be blocked by some proxies/load balancers not configured for gRPC).
- **OTLP/HTTP** (`exporter-trace-otlp-http` etc.) — protobuf or JSON over plain
  HTTP/1.1, easier to get through arbitrary infrastructure, slightly higher overhead
  per request than gRPC.
- Vendor-specific exporters (Datadog, etc.) if not routing through a
  Collector/OTLP-compatible backend.

Choice is mostly an infrastructure question (what can reach the Collector/backend
from where the Node process runs), not a code-complexity one — the SDK-level API is
the same shape regardless (`SpanExporter`/`MetricExporter`/`LogRecordExporter`
interfaces).

## 2.5 Graceful shutdown

`NodeSDK` buffers spans/metrics/logs in memory before batching them out (§5). If the
process exits (normal exit, SIGTERM from an orchestrator, uncaught exception) without
calling `sdk.shutdown()`, whatever's still buffered is lost — commonly the *last*
handful of spans right before a crash, which are exactly the ones you'd want most
when debugging that crash. Production Node services need explicit shutdown handling
on `SIGTERM`/`SIGINT` (and ideally `beforeExit`) that awaits `sdk.shutdown()` (which
flushes all registered processors/exporters) before the process actually exits, with a
bounded timeout so a stuck exporter can't hang process shutdown indefinitely.

## 2.6 Server-side attribute/PII considerations

Auto-instrumentation for `http`/`express`/etc. captures things like full URLs, route
patterns, and (for some instrumentations, configurably) request/response headers —
worth being deliberate about: URLs can contain query-string secrets or PII, and
headers can contain auth tokens or cookies. This is normally handled via
instrumentation-specific config (e.g. `ignoreIncomingRequestHook`, header
allow-lists) rather than a global scrub-everything approach, since what's sensitive
is application-specific.
