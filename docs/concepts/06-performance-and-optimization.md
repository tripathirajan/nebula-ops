# 6. Performance and optimization — concepts, tutorial, and scenarios

## 6.1 Where overhead actually comes from

Four distinct cost centers, worth separating because they're tuned differently:

1. **Instrumentation overhead** — the cost of the patched function call itself
   (creating a span object, recording attributes, timing) — small per-call, but
   multiplies by call volume. Auto-instrumentation on a very hot path
   (e.g. instrumenting every Redis GET in a cache-heavy service) can add up.
2. **Context propagation overhead** — `AsyncLocalStorage` (Node) or Zone.js
   (browser) adds a small fixed cost to _every_ async operation in the process once
   active, not just instrumented ones (ch. 2 §2.3, ch. 3 §3.4).
3. **In-memory buffering overhead** — holding thousands of unexported spans/logs in
   the processor's queue (ch. 5) costs real memory, proportional to `maxQueueSize` ×
   average span/log size.
4. **Export/network overhead** — serialization (protobuf/JSON) plus the actual
   network call — the part batching (ch. 5) exists specifically to amortize.

**Official references used throughout this chapter:**

- Sampling concepts and sampler types: https://opentelemetry.io/docs/languages/js/sampling/
- `ParentBased`/`TraceIdRatioBased` API reference: https://open-telemetry.github.io/opentelemetry-js/classes/_opentelemetry_sdk_trace_base.ParentBasedSampler.html
- Span/attribute limits config: https://opentelemetry.io/docs/languages/sdk-configuration/general/#attribute-limits
- Collector tail-sampling processor: https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/tailsamplingprocessor
- Resource detectors (Node): https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/opentelemetry-resources

## 6.2 Sampling as the primary lever

Sampling (ch. 1 §1.6) is the highest-leverage cost control because it reduces cost at
every downstream stage at once — fewer sampled traces means less instrumentation work
spent recording attributes on spans that get discarded, smaller queues, fewer export
calls, less backend ingestion cost.

**In code:**

```ts
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';

const provider = new NodeTracerProvider({
  sampler: new ParentBasedSampler({
    // Root sampler: used when there's no parent (or no valid remote parent) to defer to.
    root: new TraceIdRatioBasedSampler(0.1), // sample 10% of new traces
  }),
});
```

`ParentBasedSampler` wrapping `TraceIdRatioBasedSampler` (rather than using
`TraceIdRatioBasedSampler` alone) is the detail that keeps traces complete across
services (ch. 1 §1.6): if service A already decided "sampled" (because _it_ was a
root, or because _its_ parent said so), service B — wrapped the same way — respects
that inherited decision via the propagated sampled bit in `traceparent`, rather than
independently re-rolling a 10% chance and potentially producing a trace that's
sampled in A but not in B (a broken, partial trace). Using a bare
`TraceIdRatioBasedSampler(0.1)` with no `ParentBased` wrapper is a common mistake
that produces exactly that broken-trace symptom — every service in the chain makes
its own independent sampling roll.

**Environment-variable equivalent** (same precedence pattern as ch. 5's batch
tuning):

```bash
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1
```

**Always sample errors and slow requests** — a plain ratio sampler can't see "this
trace turned out to have an error" at the head-sampling decision point (ch. 1 §1.6),
since that's a tail property. Two ways teams commonly work around this while staying
head-based:

```ts
import { Sampler, SamplingDecision, SamplingResult } from '@opentelemetry/sdk-trace-base';
import { Context, Attributes, Link, SpanKind } from '@opentelemetry/api';

class AlwaysSampleHighValueRoutesSampler implements Sampler {
  constructor(
    private readonly ratio: TraceIdRatioBasedSampler,
    private readonly highValuePaths: string[],
  ) {}

  shouldSample(
    context: Context,
    traceId: string,
    spanName: string,
    spanKind: SpanKind,
    attributes: Attributes,
    links: Link[],
  ): SamplingResult {
    const path = attributes['url.path'] as string | undefined;
    if (path && this.highValuePaths.includes(path)) {
      return { decision: SamplingDecision.RECORD_AND_SAMPLED };
    }
    return this.ratio.shouldSample(context, traceId, spanName, spanKind, attributes, links);
  }

  toString() {
    return 'AlwaysSampleHighValueRoutesSampler';
  }
}
```

This custom sampler can only see attributes available **at span-start time** (e.g.
the request path) — it genuinely cannot know "this request is about to error" or
"this is about to be slow," because those are properties of how the trace _turns
out_, not how it _starts_. A route-based always-sample rule like the one above is a
legitimate, common workaround for a specific known-important path; it is not a
general substitute for "always keep error traces," which requires tail-based
sampling (§6.3) instead. A custom `Sampler`'s `shouldSample` runs on **every single
span creation** — treat it with the same defensive-coding rigor as any hot-path
production code; an exception thrown inside it is undefined/SDK-version-dependent
behavior, not something to risk.

Metrics aren't sampled the same way (ch. 1 §1.6) — cost control for metrics is almost
entirely about cardinality (§6.4), not sampling.

## 6.3 Tail-based sampling — where it actually lives

Tail-based sampling is **not** an SDK-level `Sampler` at all — the SDK-level sampler
decision (§6.2) happens per-service, per-trace-start, with no visibility into how the
trace concludes across every service involved. "Always keep traces with an error,
otherwise sample 10%" requires seeing every span from every service for a given trace
before deciding — that requires buffering complete traces somewhere that receives
spans from all your services, which in practice means configuring the
**tail-sampling processor** in an OpenTelemetry Collector deployment (linked above),
not application code:

```yaml
# collector-config.yaml (illustrative — Collector config, not this repo's code)
processors:
  tail_sampling:
    decision_wait: 10s
    policies:
      - name: keep-errors
        type: status_code
        status_code: { status_codes: [ERROR] }
      - name: keep-slow
        type: latency
        latency: { threshold_ms: 1000 }
      - name: sample-the-rest
        type: probabilistic
        probabilistic: { sampling_percentage: 10 }
```

Every SDK-level sampler (§6.2) should be set to sample generously (or `AlwaysOn`)
_upstream of_ a Collector doing tail sampling — if the SDK already dropped 90% of
traces at the head, the Collector never even sees the error/slow traces among that
90% to apply its "always keep" policies to. This is a real, easy-to-get-backwards
combination worth being deliberate about: head sampling and tail sampling are not
independent knobs you can each set to "10%" and expect to combine sensibly.

## 6.4 Cardinality control (mostly a metrics/logs concern)

**Cardinality** = the number of distinct attribute-value combinations a metric or
label set can take. A Counter with attributes `{route, status_code}` where `route`
has 40 distinct values and `status_code` has 6 creates up to 240 time series — fine.
The same Counter with a `user_id` attribute (millions of distinct values) creates
effectively unbounded time series — this is the single most common way teams
accidentally blow up their metrics backend's cost and query performance ("cardinality
explosion").

**Concrete mistake and its fix:**

```ts
// MISTAKE: unbounded cardinality on a metric attribute
const requestCounter = meter.createCounter('http.requests');
requestCounter.add(1, {
  'http.route': '/orders/:id',
  'user.id': userId, // ← one distinct time series PER USER, potentially millions
});
```

```ts
// FIX: keep high-cardinality identifiers off metrics; put them on spans/logs instead,
// where each record is independent rather than aggregated into a time series.
const requestCounter = meter.createCounter('http.requests');
requestCounter.add(1, {
  'http.route': '/orders/:id', // bounded — one value per route pattern, not per raw URL
  'http.response.status_code': 200, // bounded — a small fixed set of codes
});

// user_id still worth recording — just on the span, not the counter:
const span = tracer.startSpan('orders.get');
span.setAttribute('user.id', userId); // fine here — spans aren't pre-aggregated by attribute combination
span.end();
```

The difference isn't "don't record `user_id` anywhere" — it's "record it on the
signal that stores each occurrence as its own record (a span, or a log line) rather
than the signal that pre-aggregates by attribute combination (a metric)." Traces
tolerate high-cardinality attributes far better than metrics precisely because each
span is stored as its own record rather than aggregated into a time series keyed by
attribute combination — this is the single most common cause of a metrics backend
becoming slow/expensive/unusable reported across OTel and Prometheus-ecosystem users
generally — worth treating as a hard rule during code review of any new metric
instrument, not a stylistic preference.

## 6.5 Batching tuning as a direct cost/latency trade-off

Covered mechanically in ch. 5 — restated here as a performance lever: larger
`maxExportBatchSize`/longer `scheduledDelayMillis` means fewer, cheaper export calls
(better throughput, lower CPU/network overhead) at the cost of higher latency before
telemetry is visible in the backend, and a larger loss window if the process crashes
before the next flush. There's no universally correct setting — it's a genuine
trade-off to expose as config (endpoint/headers/resource attributes are not the only
things worth making configurable), not something to hardcode once and assume fits
every deployment.

## 6.6 Resource detection cost

Automatic resource detectors (cloud provider metadata, container/k8s detection, host
info) typically make network calls or read `/proc`/filesystem data at SDK startup to
populate resource attributes — this adds to process **startup latency**, which
matters more for short-lived processes (CLI tools, some FaaS contexts) than for
long-lived servers where a few hundred milliseconds at boot is noise.

```ts
import {
  detectResourcesSync,
  envDetector,
  processDetector,
  hostDetector,
} from '@opentelemetry/resources';

// Only enable the detectors relevant to where this actually runs — don't default
// to "every detector available," which each add their own startup-time cost
// (env/process/host are all fast/local; a cloud-provider detector does a network
// call to a metadata endpoint that will time out — gracefully, but not instantly —
// if not actually running in that cloud).
const resource = detectResourcesSync({
  detectors: [envDetector, processDetector, hostDetector],
});
```

For a service that's genuinely deployed on, say, AWS, adding
`awsEc2Detector`/`awsEksDetector` (from `@opentelemetry/resource-detector-aws`) is
worth the startup cost since the metadata call succeeds quickly and adds real,
useful resource attributes (`cloud.provider`, `cloud.region`, instance ID). Adding
that same detector to a service that _isn't_ running on AWS just means every process
start pays a timeout wait for a metadata endpoint that will never respond — small in
absolute terms (typically capped at a short timeout), but a completely avoidable,
purely wasted cost that scales with every process restart/cold start.

## 6.7 Attribute recording cost

Every attribute set on a span/log/metric point costs some amount of
serialization/memory, and OTel does **not** automatically limit attribute count or
value size by default at the API level in a restrictive way (limits exist but are
generous by default) — recording e.g. an entire response body or a large object as a
span attribute is possible and will work, but is a real, direct cost multiplier
across buffering and export.

```ts
const provider = new NodeTracerProvider({
  spanLimits: {
    attributeCountLimit: 128, // max attributes per span before oldest are dropped
    attributeValueLengthLimit: 4096, // max characters per attribute value, truncated beyond this
    eventCountLimit: 128,
    linkCountLimit: 128,
  },
});
```

```bash
# equivalent env vars
OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT=128
OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT=4096
```

Without explicit limits, the SDK's own built-in defaults apply (check the current SDK
version's defaults rather than assuming a specific number, since these have changed
across SDK versions) — the point of setting them explicitly is making a deliberate
choice rather than inheriting whatever the SDK's default happens to be at whatever
version is currently installed. A concrete failure case this guards against: an
instrumentation or manual span accidentally recording an entire response body as a
single attribute value — with an explicit `attributeValueLengthLimit`, that gets
truncated rather than costing full serialization/network/storage weight for the
complete value. This is a discipline/convention issue (what attributes
instrumentation and application code choose to record) more than something a wrapper
can fully prevent, though sane default limits are worth setting explicitly.

## 6.8 Summary: the levers, ranked by leverage

1. **Sampling ratio** (§6.2) — set via `ParentBased(TraceIdRatioBased(ratio))`,
   highest leverage since it reduces volume at every downstream stage (ch. 5)
   simultaneously.
2. **Cardinality discipline on metrics** (§6.4) — a call-site/code-review discipline,
   not a config knob; the single highest-leverage _metrics-specific_ fix, since
   metrics aren't sampled the same way traces are — not optional at any sampling
   rate.
3. **Batch tuning** (§6.5) — real but secondary; mostly a latency-vs-throughput dial,
   not a cost-avoidance one, since the same total telemetry volume gets exported
   either way — it changes _how_ it's sent, not _how much_.
4. **Attribute-size/count discipline** (§6.7) — real but smallest leverage of the
   four; matters most as a backstop against one bad instrumentation site dominating.
5. **Resource-detector selection** (§6.6) — smallest overall impact, but free to get
   right and purely wasted cost to get wrong.

## 6.9 Edge cases and grey areas checklist

| #   | Scenario                                                                                                   | What actually happens                                                                                                                                                                                      | Reference |
| --- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | Bare `TraceIdRatioBasedSampler` used instead of `ParentBased(TraceIdRatioBased(...))`                      | Every service in a call chain independently re-samples — traces become incomplete/broken across service boundaries                                                                                         | §6.2      |
| 2   | SDK-level sampling set very low (e.g. 1%) while relying on Collector tail-sampling to "always keep errors" | Tail sampling can't rescue traces the SDK already dropped at the head — the two need to be reasoned about together, not independently                                                                      | §6.3      |
| 3   | `user_id`/request ID/raw URL placed on a metric attribute                                                  | Unbounded time-series growth ("cardinality explosion") — the most common cause of metrics backend cost/performance blowups                                                                                 | §6.4      |
| 4   | Large object or full response body accidentally set as a span attribute value                              | Without an explicit `attributeValueLengthLimit`, full value is serialized/exported/stored — real, avoidable cost multiplier from one bad call site                                                         | §6.7      |
| 5   | Cloud-provider resource detector enabled on a service not running in that cloud                            | Metadata-endpoint call times out on every process start — wasted, avoidable startup latency                                                                                                                | §6.6      |
| 6   | Custom `Sampler` (§6.2) throws an exception inside `shouldSample`                                          | Undefined/SDK-version-dependent behavior — treat a custom sampler's `shouldSample` as needing the same defensive-coding rigor as any hot-path production code, since it runs on every single span creation | §6.2      |
