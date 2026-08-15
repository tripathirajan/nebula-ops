# OpenTelemetry concepts primer

Before freezing any `@nebula-ops/otel` API surface, this is the shared understanding
of OpenTelemetry (OTel) itself — vendor-neutral, no `@nebula-ops` design decisions in
here. The architecture docs (`../architecture.md`, `../package-specs/*.md`) build on
top of this; if something in those docs conflicts with a concept explained here,
this primer wins and the architecture doc should be corrected.

**Status: complete.** All nine chapters are at tutorial depth — runnable-shape code
per scenario, official OTel doc links, and an edge-case/grey-area checklist per
chapter (except ch. 1, which is pure foundational concepts with no code of its own,
and ch. 8, which is the synthesis chapter). Ready to push.

## Reading order

1. [`01-fundamentals.md`](01-fundamentals.md) — the three signals (traces, metrics,
   logs), Resource, Context, API vs SDK split, sampling, manual vs auto
   instrumentation, the Collector.
2. [`02-otel-node.md`](02-otel-node.md) — NodeSDK bootstrap, what happens to
   auto-instrumentation for libraries you don't use, version-compatibility grey
   areas, custom/manual spans, inbound HTTP server spans, outbound HTTP/DB/Redis/AWS
   client spans, message-queue producer/consumer context propagation, ESM
   limitations, and a 13-item edge-case checklist.
3. [`03-otel-web.md`](03-otel-web.md) — WebTracerProvider bootstrap, why the browser
   has no lazy auto-instrumentation the way Node does, Zone vs Stack context
   managers with concrete failure examples, CORS trace-header propagation and what
   breaks if it's misconfigured either direction, web-vitals/console bridges,
   exporter security posture and payload budget, and a 10-item edge-case checklist.
4. [`04-logging-integration.md`](04-logging-integration.md) — the three
   logger-integration patterns (correlation-only / Logs Bridge / full replacement)
   with working pino/winston/OTel-Logs-API code for each, severity mapping, and an
   edge-case checklist.
5. [`05-processing-and-batching.md`](05-processing-and-batching.md) — Simple vs
   Batch processors in code, what queue overflow and export retry/failure actually
   look like, multiple processors on one provider, MetricReader, shutdown/flush
   semantics, and an edge-case checklist.
6. [`06-performance-and-optimization.md`](06-performance-and-optimization.md) —
   sampler config in code (including the `ParentBased` mistake to avoid), tail
   sampling and where it actually lives (the Collector, not the SDK), a concrete
   cardinality mistake-and-fix, attribute/span limits, resource-detector cost, and
   an edge-case checklist.
7. [`07-generic-reusable-design.md`](07-generic-reusable-design.md) — a concrete
   two-service copy-paste-drift failure example and the config-driven fix, escape
   hatches, environment-agnostic-core enforcement, testability before/after code,
   versioning-blast-radius example, and an edge-case checklist.
8. [`08-why-this-layer.md`](08-why-this-layer.md) — synthesis: given ch. 1–7, what
   concretely is worth wrapping, an explicit concept→package mapping table, and 9
   open questions for Phase 1 sign-off (3 carried over, 6 new — surfaced by the
   deep-dive into instrumentation, PII risk in DB/Redis attributes, Redis pub/sub,
   message-queue context scoping, ESM support, and — from ch. 9 — SSR/hydration
   trace-context bridging).
9. [`09-otel-web-in-react.md`](09-otel-web-in-react.md) — using `otel-web`'s
   `WebTracerProvider`/instrumentation foundations inside a React app specifically:
   bootstrap-before-render ordering, the `StrictMode` double-span gotcha, a
   component-scoped `useSpan` pattern and why it's `useRef`-based rather than
   `useMemo`-based, router-agnostic route-change spans, error boundaries → span
   events (and what they don't catch), React 18 concurrent rendering as a genuinely
   open correctness question for context propagation, SSR/hydration trace-context
   bridging via Links, and testing with `@testing-library/react`. Directly informs
   [`../package-specs/otel-react.md`](../package-specs/otel-react.md)'s API surface.

## Ground rules for this primer

- Everything here describes **upstream OpenTelemetry** (the spec + the JS SDK
  implementations), not any `@nebula-ops` code. No `NebulaOtelConfig`, no
  `otel-core`/`otel-node`/`otel-web` references — those come later, in
  [`08-why-this-layer.md`](08-why-this-layer.md) only, as the bridge back to Phase 1's
  package specs.
- Version context: JS SDK packages referenced here track the `1.x` (traces, stable)
  and `0.5x` (metrics/logs, still pre-1.0 as of writing) lines used in
  [`../architecture.md`](../architecture.md)'s peer-dependency table.
- Code samples throughout are illustrative snippets (key API calls, not full
  copy-pasteable boilerplate with every import/config value) — verify exact imports/
  option names against the linked official docs before using them in Phase 2
  implementation, since OTel JS package APIs do shift between versions.
