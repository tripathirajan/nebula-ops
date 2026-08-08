# 1. OpenTelemetry fundamentals

## 1.1 What OTel actually is

OpenTelemetry is a **specification** for how to produce telemetry (traces, metrics,
logs) in a vendor-neutral way, plus a set of language SDKs that implement that spec,
plus a **Collector** (a standalone process) that receives, processes, and forwards
telemetry to whatever backend you use (Datadog, Grafana, Honeycomb, Jaeger, etc.).
The point of OTel is that your application code depends only on the OTel API, never
on a vendor SDK — you can change backends by changing exporter config, not
application code.

Three separate but related **signals**:

| Signal | What it captures | Core unit |
|---|---|---|
| **Traces** | The path a single request/operation takes through a system, as a tree of timed operations. | `Span` |
| **Metrics** | Aggregated numeric measurements over time (counts, durations, gauges). | `Instrument` (Counter, Histogram, Gauge, ...) recording data points |
| **Logs** | Discrete timestamped event records — the familiar "log line," but structured and, critically, correlatable to the active trace. | `LogRecord` |

## 1.2 Traces

A **span** represents one unit of work: an HTTP request handler, a DB query, a
function call you chose to instrument. A span has:

- A **name**, **start/end timestamps**, a **status** (unset/ok/error).
- A **SpanContext**: `traceId` (shared by every span in the same trace),
  `spanId` (unique to this span), `traceFlags` (e.g. sampled bit), and optionally
  `traceState` (vendor-specific extra propagation data).
- A **parent span** (or none, if it's a root span) — this is what makes a **trace** a
  tree, not a flat list. Child spans are created "inside" a parent's active context.
- **Attributes**: key-value metadata (`http.method: "GET"`, `db.statement: "..."`).
- **Events**: timestamped points within the span's lifetime (e.g. "cache miss",
  or an exception being recorded).
- **Links**: references to *other* spans/traces that are causally related but not a
  direct parent (e.g. a span that triggered a batch job later processes many original
  requests — each item can link back to its originating trace).
- A **SpanKind**: `INTERNAL`, `SERVER`, `CLIENT`, `PRODUCER`, `CONSUMER` — tells
  backends how to draw the request graph (e.g. pairing a `CLIENT` span in service A
  with the `SERVER` span it caused in service B).

**Context propagation** is what stitches spans across process boundaries into one
trace: the active SpanContext is serialized into outgoing request headers (commonly
`traceparent`/`tracestate`, the W3C Trace Context standard) and deserialized on the
receiving side to become the parent of that service's spans. Propagation *within* a
single process (across async boundaries, callbacks, promises) is a separate,
language-specific mechanism — see §1.4 and the Node/Web chapters.

## 1.3 Metrics

Metrics are pre-aggregated numbers, not raw events — this is what makes them cheap to
store and query at scale compared to traces. Instrument types:

- **Counter** — monotonically increasing (requests served, bytes sent). Cannot decrease.
- **UpDownCounter** — like Counter but can decrease (active connections, queue depth).
- **Histogram** — distribution of values (request duration, payload size); backend
  computes percentiles/buckets from recorded data points.
- **Gauge** — a current value sampled at read time (CPU %, memory usage) rather than
  something the app increments.

Metrics are collected via **MeterProvider** → **Meter** → **Instrument**, similarly
shaped to the tracing API's **TracerProvider** → **Tracer** → **Span**. A
**MetricReader** (periodic or on-demand) pulls current instrument values and hands
them to an exporter.

Every metric data point carries **attributes** too, but attribute *cardinality*
matters much more here than for traces: a Counter with a `user_id` attribute
effectively creates one time series per user, which most metrics backends handle
badly at scale (see §6.3 in the performance chapter).

## 1.4 Logs

OTel logs are the newest and (as of the versions pinned in this repo) least mature of
the three signals. A `LogRecord` has a timestamp, severity, body (the message, often
structured), and — this is the key feature relative to plain logging — it **can carry
the active trace/span context automatically**, so a log line emitted during a traced
request is queryable "show me all logs for this trace."

Two distinct ways OTel logs show up in practice, and this distinction matters a lot
for how a wrapper should be designed (see [`04-logging-integration.md`](04-logging-integration.md)):

1. **Logs Bridge API** — your existing logger (pino, winston, the browser console)
   keeps being the thing application code calls. A bridge/appender intercepts what it
   emits and forwards it into the OTel Logs pipeline (LoggerProvider → LogRecordProcessor
   → exporter), *tagging it with trace context* along the way. No application code
   changes.
2. **Direct OTel Logs API** — application code calls `logger.emit(...)` on an OTel
   `Logger` directly, bypassing any existing logging library. Rare in practice for
   teams with an established logger already; more common for greenfield code or
   infra/library code that wants zero logging-library dependency.

## 1.5 Context and propagation (the general model)

`Context` is a generic, immutable key-value carrier — the *active span* is just one
thing stored in it (under a well-known key), which is why the same `context` API
underlies both trace-parenting and arbitrary app-level context propagation. Two
propagation problems, solved differently:

- **In-process propagation** ("how does the SDK know which span is 'active' right
  now, across async callbacks, without me passing it explicitly everywhere?") — solved
  by a **ContextManager**, which is environment-specific (Node: `AsyncLocalStorage`;
  browser: Zone.js or a manual call-stack tracker). See Node/Web chapters.
- **Cross-process propagation** ("how does context survive an HTTP call to another
  service?") — solved by a **Propagator** (commonly W3C Trace Context, sometimes
  B3 or others) that serializes/deserializes context to/from request headers.
  Instrumentation libraries (fetch, XHR, http, gRPC) invoke the configured propagator
  automatically; you don't hand-roll header injection.

## 1.6 Sampling

Not every trace needs to be kept — sampling controls cost and noise. Two axes:

- **Head-based sampling** — the decision ("keep this trace or not") is made at the
  *start* of the trace (typically the root span), before you know how it turns out.
  Cheap, simple, the default in most setups. Common samplers:
  - `AlwaysOn` / `AlwaysOff`
  - `TraceIdRatioBased(ratio)` — deterministic probability sampling keyed off the
    trace ID, so the decision is consistent across services (every service sees the
    same trace ID and derives the same keep/drop decision independently).
  - `ParentBased(root)` — respect the parent's sampling decision if there is one
    (propagated via the sampled bit in `traceparent`), otherwise fall back to a root
    sampler. This is what keeps a trace *complete* across services — if service A
    decided "sampled," service B must not independently decide "not sampled" for the
    same trace.
- **Tail-based sampling** — the decision is deferred until the *whole* trace is seen
  (e.g. "keep it if any span errored, or if p99 latency, even if we'd normally
  sample it out"). Requires buffering complete traces somewhere that can see all
  spans across all services — practically, this means the **Collector** (not the
  SDK), configured with a tail-sampling processor, since only the Collector
  aggregates spans across services before forwarding.

Sampling is a trace-only concept in current OTel — metrics are aggregated (not
sampled in the same sense) and log sampling is a separate, less standardized area
(some backends support sampling correlated logs to match their trace's sampling
decision, but it's not a core SDK feature at the pinned versions).

## 1.7 Instrumentation: manual vs automatic

- **Manual instrumentation** — application code explicitly creates spans
  (`tracer.startSpan(...)`), records metrics (`counter.add(1, attrs)`), or emits logs.
  Full control, but requires developer effort at every call site.
- **Automatic instrumentation** — a library patches (monkey-patches, in Node; wraps
  global APIs, in the browser) a specific well-known library (`http`, `express`,
  `pg`, `fetch`, `XMLHttpRequest`, ...) so spans/metrics are created without the
  application calling the OTel API directly. This is what `@opentelemetry/instrumentation-*`
  packages and Node's `auto-instrumentations-node` meta-package provide.

In practice almost every real deployment uses **both**: auto-instrumentation for the
boring, high-volume boundary spans (HTTP in/out, DB calls), manual instrumentation for
business-logic spans that matter to the team specifically ("checkout.calculate_totals").

## 1.8 API vs SDK — why the split matters

OpenTelemetry JS is split into two layers:

- **`@opentelemetry/api`** — the interfaces application code (and instrumentation
  libraries) call against: `trace.getTracer()`, `context.active()`, etc. No-op by
  default — if no SDK is registered, every call is a safe no-op with negligible
  overhead. Libraries are encouraged to depend on *only* this package.
- **SDK packages** (`@opentelemetry/sdk-trace-node`, `sdk-trace-web`, `sdk-metrics`,
  `sdk-logs`, plus exporters and instrumentations) — the actual implementation:
  processors, exporters, samplers, resource detection. The *application* (not
  libraries) installs and configures one of these, which registers itself as the
  live implementation behind the API's global registration points
  (`trace.setGlobalTracerProvider`, etc.).

This split is why libraries (including internal ones) should depend on `@opentelemetry/api`
as a **peer dependency** — see [`../architecture.md`](../architecture.md) §5 for how
that applies to this repo specifically.

## 1.9 The Collector

The **OpenTelemetry Collector** is a standalone, vendor-agnostic process (or sidecar,
or gateway deployment) that sits between your services and your observability
backend. It's not required — SDKs can export directly to a backend that speaks
OTLP — but it's the standard production pattern because it lets you:

- Centralize sampling (including tail-based sampling), batching, retry, and
  backpressure logic in one place instead of duplicating it per service.
- Fan out one signal stream to multiple backends (e.g. traces to Jaeger, metrics to
  Prometheus) without each service knowing about both.
- Do attribute scrubbing/enrichment centrally (e.g. strip PII, add `k8s.pod.name`)
  without redeploying every service.
- Buffer/retry during backend outages without adding that responsibility to
  application processes.

**OTLP** (OpenTelemetry Protocol) is the wire protocol SDKs and Collectors speak to
each other — gRPC or HTTP/protobuf (or HTTP/JSON). It's what "OTLP exporter" and
"OTLP endpoint" in this repo's config refer to.

## 1.10 Resources

A **Resource** is the set of attributes describing *what produced* the telemetry —
`service.name`, `service.version`, `deployment.environment`, host/container/k8s
metadata — attached once per SDK instance (not per span/metric/log individually) and
merged into everything that SDK instance exports. Resource detection can be automatic
(env, host, cloud-provider detectors) or explicit. Semantic conventions
(`@opentelemetry/semantic-conventions`) standardize the *names* of common resource and
span attributes so a `service.name` attribute means the same thing across every
vendor's tooling.
