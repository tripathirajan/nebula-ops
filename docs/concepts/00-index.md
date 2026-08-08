# OpenTelemetry concepts primer

Before freezing any `@nebula-ops/otel` API surface, this is the shared understanding
of OpenTelemetry (OTel) itself — vendor-neutral, no `@nebula-ops` design decisions in
here. The architecture docs (`../architecture.md`, `../package-specs/*.md`) build on
top of this; if something in those docs conflicts with a concept explained here,
this primer wins and the architecture doc should be corrected.

## Reading order

1. [`01-fundamentals.md`](01-fundamentals.md) — the three signals (traces, metrics,
   logs), Resource, Context, API vs SDK split, the Collector.
2. [`02-otel-node.md`](02-otel-node.md) — NodeSDK, auto-instrumentation, Node's
   context propagation model.
3. [`03-otel-web.md`](03-otel-web.md) — WebTracerProvider, browser instrumentation,
   browser context propagation, why the browser story differs from Node's.
4. [`04-logging-integration.md`](04-logging-integration.md) — how OTel relates to
   existing logger libraries (pino, winston, console) — bridge vs replace, and
   trace/log correlation.
5. [`05-processing-and-batching.md`](05-processing-and-batching.md) — SpanProcessors,
   batch vs simple, exporter mechanics, backpressure.
6. [`06-performance-and-optimization.md`](06-performance-and-optimization.md) —
   where overhead comes from and the levers to control it (sampling, batching,
   cardinality, resource detection cost).
7. [`07-generic-reusable-design.md`](07-generic-reusable-design.md) — patterns that
   make an OTel wrapper reusable across services instead of copy-pasted boilerplate.
8. [`08-why-this-layer.md`](08-why-this-layer.md) — synthesis: given 1–7, what
   concretely is worth wrapping, and what should stay a thin pass-through to raw OTel.

## Ground rules for this primer

- Everything here describes **upstream OpenTelemetry** (the spec + the JS SDK
  implementations), not any `@nebula-ops` code. No `NebulaOtelConfig`, no
  `otel-core`/`otel-node`/`otel-web` references — those come later, in
  [`08-why-this-layer.md`](08-why-this-layer.md) only, as the bridge back to Phase 1's
  package specs.
- Version context: JS SDK packages referenced here track the `1.x` (traces, stable)
  and `0.5x` (metrics/logs, still pre-1.0 as of writing) lines used in
  [`../architecture.md`](../architecture.md)'s peer-dependency table.
