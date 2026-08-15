# 5. OTel processing: SpanProcessors, batching, and export mechanics — concepts, tutorial, and scenarios

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
named concept, **MetricReader** (§5.6), because metrics are pull/periodic-collected
rather than emitted-per-event the way spans/logs are.

**Official references used throughout this chapter:**

- `BatchSpanProcessor` API reference: https://open-telemetry.github.io/opentelemetry-js/classes/_opentelemetry_sdk_trace_base.BatchSpanProcessor.html
- Trace SDK environment variables (batch tuning via env, not just code): https://opentelemetry.io/docs/languages/sdk-configuration/general/#batch-span-processor
- `PeriodicExportingMetricReader`: https://opentelemetry.io/docs/languages/js/instrumentation/#metrics
- OTLP exporter retry behavior: https://opentelemetry.io/docs/specs/otlp/#otlphttp-response
- Collector `file_storage` extension (durable buffering): https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/extension/storage/filestorage

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
    a _test-only_ use of this idea, not a production pattern).
- **`BatchSpanProcessor`** — buffers spans in memory and exports them **periodically
  in batches**, decoupling "span ended" from "network call happened." This is the
  standard production choice, tuned by:

  | Option                 | What it controls                                                                                          | Typical default |
  | ---------------------- | --------------------------------------------------------------------------------------------------------- | --------------- |
  | `maxQueueSize`         | Max spans buffered before new ones are **dropped** (with a recorded "dropped spans" count, not silently). | 2048            |
  | `maxExportBatchSize`   | Max spans sent per single export call.                                                                    | 512             |
  | `scheduledDelayMillis` | How often the processor attempts to flush a batch, even if not full.                                      | 5000            |
  | `exportTimeoutMillis`  | How long a single export call is allowed to run before being abandoned.                                   | 30000           |

  The trade-off this tuning controls: **latency of telemetry visibility** (how long
  after a span ends before it's visible in your backend — bounded by
  `scheduledDelayMillis`) vs **efficiency/throughput** (fewer, larger export calls
  cost less overhead per span) vs **memory/data-loss risk under load**
  (`maxQueueSize` too small drops spans during traffic spikes; too large risks memory
  pressure and a bigger loss if the process crashes before flushing).

Logs have the exact same `SimpleLogRecordProcessor`/`BatchLogRecordProcessor` split
with an equivalent options shape.

**In code:**

```ts
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  SimpleSpanProcessor,
  BatchSpanProcessor,
  ConsoleSpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

// Local dev / debugging: print every span the instant it ends. Never use in production.
const devProvider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
});

// Production: buffer and batch.
const prodProvider = new NodeTracerProvider({
  spanProcessors: [
    new BatchSpanProcessor(
      new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }),
      {
        maxQueueSize: 2048,
        maxExportBatchSize: 512,
        scheduledDelayMillis: 5000,
        exportTimeoutMillis: 30000,
      },
    ),
  ],
});
```

Both processors implement the same `SpanProcessor` interface — swapping one for the
other is a one-line config change, not a code-structure change, which is why "someone
left `SimpleSpanProcessor` in the production build" is such an easy, easy-to-miss
mistake: nothing else about the setup looks wrong.

**Same tuning via environment variables** (useful when you want ops/SRE teams to be
able to adjust batching without a code deploy):

```bash
OTEL_BSP_MAX_QUEUE_SIZE=2048
OTEL_BSP_MAX_EXPORT_BATCH_SIZE=512
OTEL_BSP_SCHEDULE_DELAY=5000
OTEL_BSP_EXPORT_TIMEOUT=30000
```

These are read automatically by `BatchSpanProcessor` if constructed without explicit
options for those fields — explicit constructor options (above) take precedence over
env vars, which take precedence over the SDK's own hardcoded defaults, matching the
general OTel config-precedence pattern used throughout this repo's own
`NebulaOtelConfig` resolution (§ config shape in [`../architecture.md`](../architecture.md)).

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
production rather than exporting directly from every service to the final backend —
the Collector can apply its own, centrally-tuned queuing/retry policy (including
on-disk buffering via its `file_storage` extension) once, instead of every service
independently risking silent drops during a backend outage.

**What queue overflow actually looks like, concretely:**

```ts
// If your service produces spans faster than BatchSpanProcessor can export them
// (traffic spike, or exporter destination is slow/down), the internal queue fills
// up to maxQueueSize. What happens next, roughly:
//
//   if (this._finishedSpans.length >= this.maxQueueSize) {
//     // span is dropped — NOT added to the queue, NOT retried later
//     this._droppedSpansCount++;
//     return;
//   }
```

There is no exception thrown, no rejected promise your application code sees — the
span you thought you created and ended simply never gets exported. The SDK tracks a
dropped-span count internally (surfaced via the SDK's own diagnostics/metrics if you
have `diag` logging enabled at a verbose level, not via any signal your business
logic can observe) — this is a monitoring gap worth being aware of: **you generally
cannot tell from application code alone that spans are being silently dropped**; you
have to either watch OTel's own internal diagnostic logs or notice the symptom
downstream (unexpectedly sparse/incomplete traces during known traffic spikes).

**Export failure and retry, concretely:**

```ts
const exporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  timeoutMillis: 10000, // per official OTLP exporter config surface
});
```

Per the OTLP spec's retry guidance (linked above): OTLP HTTP exporters retry on
**retryable** failures (HTTP 429, 502, 503, 504, and connection-level errors) with
backoff, up to a small internal retry budget — and give up, dropping that batch, on
non-retryable failures (4xx other than 429) or once the retry budget is exhausted.
This retry logic lives **inside the exporter**, not the processor — the processor's
job (§5.2) is queuing/batching; the exporter's job is the actual network attempt and
its own retry/backoff around that attempt. Once an exporter gives up on a batch,
that batch is gone — there's no SDK-level fallback to, say, write it to local disk
and retry later; that durability property, if you need it, is what routing through a
Collector (with its `file_storage` extension, linked above) buys you instead of
trying to build it into every service.

## 5.4 Multiple processors, one provider

A `TracerProvider` can be configured with more than one SpanProcessor (e.g. a
`BatchSpanProcessor` exporting to your real backend, plus, in dev, a
`SimpleSpanProcessor` with `ConsoleSpanExporter` for local visibility) — processors
run independently, each seeing every span. Same for `LogRecordProcessor`s.

```ts
const provider = new NodeTracerProvider({
  spanProcessors: [
    // Always export to the real backend, batched.
    new BatchSpanProcessor(new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT })),
    // In dev/staging only, also print every span immediately for local visibility.
    ...(process.env.NODE_ENV !== 'production'
      ? [new SimpleSpanProcessor(new ConsoleSpanExporter())]
      : []),
  ],
});
```

Each processor gets an independent callback on every span end — one exporter failing
or being slow does not block or affect the other; they're not chained, they're
fanned out. This is the mechanism (not `if (dev) use console else use otlp`
branching on the _processor type itself_) for supporting "both, conditionally" setups
cleanly.

## 5.5 Metrics: MetricReader instead of a processor

Metrics don't have a discrete "this one thing just happened, decide whether to
process it now" moment the way a span-end or log-emit does — instruments accumulate
values continuously (a Counter keeps incrementing) and someone has to _read_ their
current state periodically. That's `PeriodicExportingMetricReader` (pull the current
value of every registered instrument on a fixed interval, e.g. every 60s, and hand it
to a `MetricExporter`) — conceptually parallel to `BatchSpanProcessor`'s
`scheduledDelayMillis`, but there's no "batch full" trigger the way spans/logs have,
since a read is always "everything, right now," not "whatever accumulated since
last time." There's also `manualreader`-style on-demand collection (used by
pull-based backends like Prometheus scraping an endpoint rather than the SDK pushing
via OTLP), which matters mainly for backend-choice reasons, not for wrapper design.

```ts
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';

const meterProvider = new MeterProvider({
  readers: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }),
      exportIntervalMillis: 60000, // read + export current instrument state every 60s
    }),
  ],
});

const meter = meterProvider.getMeter('checkout-service');
const ordersCounter = meter.createCounter('orders.created', {
  description: 'Number of orders created',
});

// application code, anywhere, anytime:
ordersCounter.add(1, { 'order.payment_method': 'card' });
// this doesn't trigger an export itself — it just updates in-memory instrument state;
// the next scheduled PeriodicExportingMetricReader tick reads and exports it
```

The key mechanical difference from `BatchSpanProcessor` worth internalizing: calling
`.add()` does **not** enqueue anything for export the way ending a span does — it
mutates the Counter's current accumulated value in place. There's no per-call queue
to overflow (§5.3's failure mode) the way spans have; the only per-tick cost is
proportional to the number of _distinct attribute combinations_ ever recorded
(cardinality, ch. 6 §6.4), not the number of `.add()` calls.

## 5.6 Shutdown and flush semantics

Every provider (`TracerProvider`, `MeterProvider`, `LoggerProvider`) exposes
`forceFlush()` (flush whatever's buffered right now, without shutting down) and
`shutdown()` (flush, then stop accepting new telemetry and release exporter
resources). Two operationally distinct use cases:

- **Process shutdown** (ch. 2 §2.5 for Node specifics) — call `shutdown()` so nothing
  buffered at exit is lost.
- **Mid-life explicit flush points** — e.g. a serverless/FaaS environment where the
  process may be frozen or reused between invocations and there's no reliable
  "shutdown" event, so `forceFlush()` is called at the end of each invocation instead.
  This is a materially different operating model than a long-lived server process and
  worth flagging explicitly if/when a FaaS target is ever in scope (currently out of
  scope per the package specs, which target long-lived Node services and browsers).

```ts
async function shutdown() {
  await Promise.all([
    tracerProvider.shutdown(), // flushes pending batched spans, then stops accepting new ones
    meterProvider.shutdown(),
    loggerProvider.shutdown(),
  ]);
}

process.on('SIGTERM', async () => {
  await shutdown();
  process.exit(0);
});

// FaaS-style mid-life flush (no reliable process-exit event to hook):
async function handler(event: unknown) {
  const result = await processEvent(event);
  await tracerProvider.forceFlush(); // flush without shutting down — the process may be reused
  return result;
}
```

`shutdown()` and `forceFlush()` are genuinely different operations, not
shutdown-with-extra-steps vs shutdown-without: `forceFlush()` leaves the provider
fully usable afterward (more spans can still be created and will still export
normally on the next batch/interval); `shutdown()` is terminal — no further
telemetry from that provider instance will export after it resolves. Mixing them up
(e.g. calling `shutdown()` at the end of every FaaS invocation) means every
subsequent invocation in a reused/warm execution environment silently produces no
telemetry at all, since the provider was already torn down.

## 5.7 Edge cases and grey areas checklist

| #   | Scenario                                                                                 | What actually happens                                                                                                                                                                                                                                                                                           | Reference        |
| --- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | `SimpleSpanProcessor` accidentally left in a production build                            | Every span end blocks briefly on a synchronous export call — real, measurable latency added to every traced operation, not just a "less efficient" choice                                                                                                                                                       | §5.2             |
| 2   | Traffic spike exceeds `maxQueueSize`                                                     | Spans silently dropped, no exception, no signal to application code — only visible via OTel's own internal diagnostics or by noticing sparse traces after the fact                                                                                                                                              | §5.3             |
| 3   | Exporter destination returns HTTP 401/403 (misconfigured auth, not a transient failure)  | **Not** retried (non-retryable per the OTLP spec) — that batch is dropped immediately; worth alerting on this specific class of exporter error since it indicates a config problem, not backend flakiness                                                                                                       | §5.3             |
| 4   | Collector/backend has an extended outage longer than the exporter's retry budget         | All spans produced during the outage (beyond what fits in the queue during the outage) are lost — there is no SDK-level durable local buffer; only a Collector with disk-backed storage provides that                                                                                                           | §5.3             |
| 5   | `forceFlush()` called where `shutdown()` was intended (e.g. at true process exit)        | Buffered spans do get flushed, but the provider is left running — harmless at process exit (process dies right after anyway) but wastes the explicit teardown                                                                                                                                                   | §5.6             |
| 6   | `shutdown()` called where `forceFlush()` was intended (e.g. end of each FaaS invocation) | Provider is torn down — every subsequent invocation on a reused/warm instance produces zero telemetry silently, since there's no active processor left to record into                                                                                                                                           | §5.6             |
| 7   | Metric instrument recorded with an unbounded-cardinality attribute (e.g. `user_id`)      | Not a batching/processing failure exactly, but relevant here: `PeriodicExportingMetricReader` still has to serialize and export every distinct attribute-combination's data point on every tick — this is where cardinality (ch. 6 §6.4) becomes a processing-cost problem, not just a backend-storage-cost one | §5.5, ch. 6 §6.4 |
