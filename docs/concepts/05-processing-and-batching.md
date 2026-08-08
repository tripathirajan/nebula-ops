# 5. OTel processing: SpanProcessors, batching, and export mechanics

## 5.1 Where processing sits in the pipeline

For every signal, the shape is the same:

```
instrumentation/manual API call
        │
        ▼
  Processor(s)            ← can inspect/modify/drop before export; decides *when* export happens
        │
        ▼
   Exporter                ← serializes + sends over the wire (OTLP/gRPC, OTLP/HTTP, vendor-specific)
        │
        ▼
  Collector / backend
```

Traces use **SpanProcessor**, logs use **LogRecordProcessor** — same concept, same
two built-in implementations, described below. Metrics use a related but distinctly
named concept, **MetricReader** (§5.5), because metrics are pull/periodic-collected
rather than emitted-per-event the way spans/logs are.

## 5.2 SimpleSpanProcessor vs BatchSpanProcessor

- **`SimpleSpanProcessor`** — exports each span **immediately, synchronously with
  span end**, one at a time. No batching, no delay. Simple to reason about, but:
  - Every span end blocks (briefly) on a network call to the exporter.
  - Under load, this means one export call per span — enormous request volume and
    per-request overhead compared to batching.
  - **Essentially never the right choice for production** — its practical use is
    local debugging (e.g. paired with a `ConsoleSpanExporter` to print spans as
    they happen) and, indirectly, test setups (paired with an in-memory exporter
    where you want spans available for assertions immediately, without waiting on a
    batch timer — see the `otel-testing` non-goal notes in
    [`../package-specs/otel-testing.md`](../package-specs/otel-testing.md), which is
    a *test-only* use of this idea, not a production pattern).
- **`BatchSpanProcessor`** — buffers spans in memory and exports them **periodically
  in batches**, decoupling "span ended" from "network call happened." This is the
  standard production choice, tuned by:

  | Option | What it controls | Typical default |
  |---|---|---|
  | `maxQueueSize` | Max spans buffered before new ones are **dropped** (with a recorded "dropped spans" count, not silently). | 2048 |
  | `maxExportBatchSize` | Max spans sent per single export call. | 512 |
  | `scheduledDelayMillis` | How often the processor attempts to flush a batch, even if not full. | 5000 |
  | `exportTimeoutMillis` | How long a single export call is allowed to run before being abandoned. | 30000 |

  The trade-off this tuning controls: **latency of telemetry visibility** (how long
  after a span ends before it's visible in your backend — bounded by
  `scheduledDelayMillis`) vs **efficiency/throughput** (fewer, larger export calls
  cost less overhead per span) vs **memory/data-loss risk under load**
  (`maxQueueSize` too small drops spans during traffic spikes; too large risks memory
  pressure and a bigger loss if the process crashes before flushing).

Logs have the exact same `SimpleLogRecordProcessor`/`BatchLogRecordProcessor` split
with an equivalent options shape.

## 5.3 Backpressure and data loss

When the queue is full (`maxQueueSize` exceeded) or an export call fails/times out,
the processor's default behavior is to **drop** the excess telemetry rather than
block application code or grow memory unboundedly — this is a deliberate design
choice in OTel SDKs: telemetry should never be allowed to take down or meaningfully
slow the application producing it. Retries on export failure are typically the
exporter's responsibility (a small number of retries with backoff, configurable per
exporter), not the processor's — once a batch is handed to the exporter and still
fails, it's gone; there's no infinite local durability queue in the SDK.

This is one of the strongest arguments for routing through a **Collector** in
production rather than exporting directly from every service to the final backend
(§1.9) — the Collector can apply its own, centrally-tuned queuing/retry policy
(including on-disk buffering via its `file_storage` extension) once, instead of every
service independently risking silent drops during a backend outage.

## 5.4 Multiple processors, one provider

A `TracerProvider` can be configured with more than one SpanProcessor (e.g. a
`BatchSpanProcessor` exporting to your real backend, plus, in dev, a
`SimpleSpanProcessor` with `ConsoleSpanExporter` for local visibility) — processors
run independently, each seeing every span. Same for `LogRecordProcessor`s. This is
the mechanism a wrapper would use to support "export to OTLP AND optionally print to
console in dev," without special-casing it in application code.

## 5.5 Metrics: MetricReader instead of a processor

Metrics don't have a discrete "this one thing just happened, decide whether to
process it now" moment the way a span-end or log-emit does — instruments accumulate
values continuously (a Counter keeps incrementing) and someone has to *read* their
current state periodically. That's `PeriodicExportingMetricReader` (pull the current
value of every registered instrument on a fixed interval, e.g. every 60s, and hand it
to a `MetricExporter`) — conceptually parallel to `BatchSpanProcessor`'s
`scheduledDelayMillis`, but there's no "batch full" trigger the way spans/logs have,
since a read is always "everything, right now," not "whatever accumulated since
last time." There's also `manualreader`-style on-demand collection (used by
pull-based backends like Prometheus scraping an endpoint rather than the SDK pushing
via OTLP), which matters mainly for backend-choice reasons, not for wrapper design.

## 5.6 Shutdown and flush semantics

Every provider (`TracerProvider`, `MeterProvider`, `LoggerProvider`) exposes
`forceFlush()` (flush whatever's buffered right now, without shutting down) and
`shutdown()` (flush, then stop accepting new telemetry and release exporter
resources). Two operationally distinct use cases:

- **Process shutdown** (§2.5 for Node specifics) — call `shutdown()` so nothing
  buffered at exit is lost.
- **Mid-life explicit flush points** — e.g. a serverless/FaaS environment where the
  process may be frozen or reused between invocations and there's no reliable
  "shutdown" event, so `forceFlush()` is called at the end of each invocation instead.
  This is a materially different operating model than a long-lived server process and
  worth flagging explicitly if/when a FaaS target is ever in scope (currently out of
  scope per the package specs, which target long-lived Node services and browsers).
