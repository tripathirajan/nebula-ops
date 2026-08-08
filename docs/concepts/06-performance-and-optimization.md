# 6. Performance and optimization

## 6.1 Where overhead actually comes from

Four distinct cost centers, worth separating because they're tuned differently:

1. **Instrumentation overhead** — the cost of the patched function call itself
   (creating a span object, recording attributes, timing) — small per-call, but
   multiplies by call volume. Auto-instrumentation on a very hot path
   (e.g. instrumenting every Redis GET in a cache-heavy service) can add up.
2. **Context propagation overhead** — `AsyncLocalStorage` (Node) or Zone.js
   (browser) adds a small fixed cost to *every* async operation in the process once
   active, not just instrumented ones (§2.3, §3.3).
3. **In-memory buffering overhead** — holding thousands of unexported spans/logs in
   the processor's queue (§5.2) costs real memory, proportional to `maxQueueSize` ×
   average span/log size.
4. **Export/network overhead** — serialization (protobuf/JSON) plus the actual
   network call — the part batching (§5) exists specifically to amortize.

## 6.2 Sampling as the primary lever

Sampling (§1.6) is the highest-leverage cost control because it reduces cost at every
downstream stage at once — fewer sampled traces means less instrumentation work spent
recording attributes on spans that get discarded, smaller queues, fewer export calls,
less backend ingestion cost. Two practical patterns:

- **Ratio-based head sampling** (`TraceIdRatioBased`) for routine, high-volume
  traffic — e.g. sample 10% of requests in production, 100% in staging/local.
- **Always sample errors and slow requests** — a plain ratio sampler can't see
  "this trace turned out to have an error" at the head-sampling decision point
  (§1.6), since that's a tail property. Two ways teams commonly work around this
  while staying head-based:
  - A custom `Sampler` that inspects available root-span attributes at start time
    (e.g. always sample requests to certain high-value routes).
  - Accept the limitation of head sampling and rely on the Collector's tail-sampling
    processor when "always keep errors regardless of sample rate" genuinely matters —
    this is the correct tool for that requirement, not something to fake at the SDK
    level.

Metrics aren't sampled the same way (§1.6) — cost control for metrics is almost
entirely about cardinality (§6.3), not sampling.

## 6.3 Cardinality control (mostly a metrics/logs concern)

**Cardinality** = the number of distinct attribute-value combinations a metric or
label set can take. A Counter with attributes `{route, status_code}` where `route`
has 40 distinct values and `status_code` has 6 creates up to 240 time series — fine.
The same Counter with a `user_id` attribute (millions of distinct values) creates
effectively unbounded time series — this is the single most common way teams
accidentally blow up their metrics backend's cost and query performance ("cardinality
explosion"). The fix is almost always at the instrumentation-authoring level: never
put unbounded-cardinality values (user IDs, request IDs, raw URLs with path params,
free-text) into metric attributes. High-cardinality values belong on **spans**
(where each span is already its own record, so cardinality isn't multiplying a
pre-aggregated series) or in **log** attributes, not metric attributes.

Traces tolerate high-cardinality attributes far better than metrics because each span
is stored as its own record rather than aggregated into a time series keyed by
attribute combination — this asymmetry is a genuinely important design fact, not a
detail: "which signal should this piece of data go on" should be decided partly by
its cardinality, not only by "is it numeric" or "is it a message."

## 6.4 Batching tuning as a direct cost/latency trade-off

Covered mechanically in §5.2 — restated here as a performance lever: larger
`maxExportBatchSize`/longer `scheduledDelayMillis` means fewer, cheaper export calls
(better throughput, lower CPU/network overhead) at the cost of higher latency before
telemetry is visible in the backend, and a larger loss window if the process crashes
before the next flush. There's no universally correct setting — it's a genuine
trade-off to expose as config (endpoint/headers/resource attributes are not the only
things worth making configurable — see the config-shape discussion this feeds into
in [`08-why-this-layer.md`](08-why-this-layer.md)), not something to hardcode once
and assume fits every deployment.

## 6.5 Resource detection cost

Automatic resource detectors (cloud provider metadata, container/k8s detection,
host info) typically make network calls or read `/proc`/filesystem data at SDK
startup to populate resource attributes — this adds to process **startup latency**,
which matters more for short-lived processes (CLI tools, some FaaS contexts) than for
long-lived servers where a few hundred milliseconds at boot is noise. Detectors that
try to reach unavailable metadata endpoints (e.g. a cloud-provider detector running
outside that cloud) typically time out gracefully rather than hang, but "gracefully"
still means "waits out a timeout" — worth being deliberate about which detectors are
actually enabled rather than defaulting to "all of them" in every environment.

## 6.6 Attribute recording cost

Every attribute set on a span/log/metric point costs some amount of
serialization/memory, and OTel does **not** automatically limit attribute count or
value size by default at the API level (some SDKs impose configurable limits —
`spanLimits.attributeCountLimit`, `attributeValueLengthLimit` — but they're not
restrictive by default). Recording e.g. an entire response body or a large object as
a span attribute is possible and will work, but is a real, direct cost multiplier
across buffering and export — this is a discipline/convention issue (what attributes
instrumentation and application code choose to record) more than something a wrapper
can fully prevent, though sane default limits are worth setting explicitly rather
than leaving at whatever the SDK's own defaults happen to be.

## 6.7 Summary: the levers, ranked by leverage

1. **Sampling ratio** — cuts cost at every downstream stage simultaneously; highest
   leverage, coarsest control.
2. **Cardinality discipline on metrics** — prevents the specific failure mode that
   most commonly makes a metrics backend unusable/expensive; not optional at any
   sampling rate, since metrics aren't sampled.
3. **Batch tuning** — real but secondary; mostly a latency-vs-throughput dial, not a
   cost-avoidance one, since the same total telemetry volume gets exported either way
   — it changes *how* it's sent, not *how much*.
4. **Attribute-size/count discipline** — real but smallest leverage of the four;
   matters most as a "avoid one bad instrumentation site from dominating" backstop.
