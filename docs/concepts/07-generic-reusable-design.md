# 7. What makes an OTel wrapper generic and reusable — concepts, tutorial, and scenarios

This chapter is still about general principles — not `@nebula-ops` specifics — but
framed toward "what would make _any_ org's OTel wrapper actually reusable across many
services," since that's the property this repo's package specs are trying to
achieve. Still vendor/wrapper-neutral in spirit — the code below is illustrative of
the _pattern_, not a preview of `@nebula-ops/otel`'s actual implementation (that's
[`../package-specs/`](../package-specs/)'s job).

**Official references used in this chapter:**

- OTel JS API vs SDK design rationale: https://opentelemetry.io/docs/languages/js/instrumentation/#tracer
- In-memory exporters for testing: https://github.com/open-telemetry/opentelemetry-js/blob/main/packages/opentelemetry-sdk-trace-base/src/export/InMemorySpanExporter.ts
- Semantic conventions (why shared attribute naming matters org-wide): https://opentelemetry.io/docs/specs/semconv/

## 7.1 The failure mode this all guards against, concretely

**Service A's setup**, written first:

```ts
const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    'service.name': 'checkout-service',
    'deployment.environment': 'production',
  }),
  traceExporter: new OTLPTraceExporter({ url: 'https://otel-collector.internal:4318/v1/traces' }),
  spanProcessor: new BatchSpanProcessor(exporter, {
    maxQueueSize: 2048,
    scheduledDelayMillis: 5000,
  }),
  sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(0.1) }),
  instrumentations: [getNodeAutoInstrumentations()],
});
```

**Service B's setup**, copy-pasted from A six months later and lightly edited:

```ts
const sdk = new NodeSDK({
  resource: resourceFromAttributes({ 'service.name': 'inventory-service', env: 'prod' }), // ← 'env', not 'deployment.environment' — typo'd during copy-paste, nobody caught it
  traceExporter: new OTLPTraceExporter({ url: 'https://otel-collector.internal:4318/v1/traces' }),
  spanProcessor: new BatchSpanProcessor(exporter), // ← batch options dropped entirely during copy-paste, silently reverts to SDK defaults
  // sampler config forgotten entirely — this service samples 100% by default, unnoticed until someone asks why its trace volume is 10x checkout-service's
  instrumentations: [getNodeAutoInstrumentations()],
});
```

Nothing here throws an error. Nothing fails CI. Six months after that, a third
service copies from B, inheriting both drifted mistakes plus whatever new one gets
introduced this time. Without a shared, versioned package, this is what "everyone
independently wires up OTel" converges toward in practice: team A copies team B's
`NodeSDK` setup code into a new service, tweaks a few values, and now there are two
near-identical-but-subtly-different OTel configs in the org, each independently prone
to drift — and nobody can safely make an org-wide change (e.g. "add a new mandatory
resource attribute for a new observability backend migration") without touching every
service's copy-pasted setup individually. A generic, reusable package is what turns
that into a single version bump. §7.2–§7.7 below are the specific design properties
that make a wrapper actually deliver that outcome instead of just being "a second
place the same mistakes can happen."

## 7.2 Config-driven, not code-driven, per-service variation

Every service needs the _same shape_ of setup (Resource, exporter, sampler, context
manager, instrumentation set) with _different values_ (service name, endpoint,
sampling ratio, which instrumentations apply). A reusable wrapper's job is to make
that variation entirely a config problem, not a code problem — a new service should
be able to get fully-configured telemetry by supplying a config object/env vars, not
by writing SDK-assembly code.

**Fix applied to §7.1's failure mode:**

```ts
// What every service actually writes, regardless of what it does internally:
import { startNodeSdk } from '@your-org/otel-node'; // illustrative package name

startNodeSdk({
  serviceName: 'inventory-service',
  environment: 'production',
  sampling: { ratio: 0.1 },
});
```

```ts
// Inside the wrapper package (not something each service authors or can typo):
export function startNodeSdk(config: Partial<WrapperConfig>) {
  const resolved = resolveConfig(config); // one implementation of attribute naming, env resolution, defaults
  const sdk = new NodeSDK({
    resource: buildResource(resolved), // always uses 'deployment.environment', never 'env' — not a per-call-site decision anymore
    traceExporter: new OTLPTraceExporter({ url: resolved.endpoint, headers: resolved.headers }),
    spanProcessor: new BatchSpanProcessor(exporter, DEFAULT_BATCH_OPTIONS), // can't be silently dropped by a copy-paste omission — it's not optional in the wrapper's code path
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(resolved.sampling.ratio),
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
  return sdk;
}
```

The batch tuning, attribute naming, and sampler wiring all moved from "code every
service author has to reproduce correctly" to "code that exists exactly once,
version-controlled, tested." A service can still override any of it (§7.4) — the
fix isn't "remove flexibility," it's "make correctness the default instead of
something each copy-paste has to re-earn."

## 7.3 Depend on the API, implement against the SDK, expose neither raw

Application/library code should only ever need `@opentelemetry/api` types (ch. 1
§1.8). A reusable wrapper sits _between_ the raw SDK (which it configures) and
application code (which it hands a simplified surface to) — this means:

- The wrapper's public exports should be small, opinionated functions
  (`startNodeSdk(config)`, not "here are 15 SDK classes, assemble them yourself").
- Where the wrapper _does_ re-export raw OTel API pieces (`trace`, `context`), it
  should be exactly the API package's own exports, not a modified/renamed version —
  so application code written against "the OTel API" isn't secretly locked into a
  wrapper-specific dialect that diverges from OTel docs/examples/community knowledge.

## 7.4 Escape hatches — flexibility without losing the default's safety

```ts
export interface NodeSdkOptions extends Partial<OtelConfig> {
  traceExporter?: SpanExporter; // override the default OTLP exporter entirely
  instrumentations?: Instrumentation[]; // override the default instrumentation set entirely
}

export function startNodeSdk(options: NodeSdkOptions = {}) {
  const resolved = resolveConfig(options);
  const sdk = new NodeSDK({
    resource: buildResource(resolved),
    traceExporter: options.traceExporter ?? new OTLPTraceExporter({ url: resolved.endpoint }),
    instrumentations: options.instrumentations ?? [getNodeAutoInstrumentations()],
    // ...
  });
  sdk.start();
  return sdk;
}
```

A service with a genuinely unusual requirement (a non-OTLP exporter, a hand-picked
instrumentation list per ch. 2 §2.2) can still supply its own — the wrapper's
opinionated defaults are a starting point services can deviate from deliberately,
not a ceiling. The difference from §7.1's failure mode: a deliberate override here is
a **visible, reviewable one-line diff** at the call site (`traceExporter: myCustomExporter`),
not a silently-diverged copy-paste six files removed from the original.

**Instrumentation-set overrides specifically replace, not merge:** a service passing
its own `instrumentations` array (as in the example above) loses the wrapper's
default set entirely unless it explicitly includes those defaults too — e.g. a
service overriding to add one uncommon library's instrumentation needs to spread the
default set plus its addition (`instrumentations: [...getNodeAutoInstrumentations(), new SomeNicheInstrumentation()]`),
not just supply the one new instrumentation and assume the HTTP/Express defaults are
still there underneath. Worth stating explicitly in the wrapper's own API docs, since
"override" vs "extend" is an easy assumption to get backwards.

## 7.5 Environment-agnostic core, concretely (why the import-restriction check matters)

If the same config schema, resource-building logic, and log-context helpers are
useful in both Node and browser contexts, that logic has to be written so it
literally cannot accidentally import something environment-specific.

```ts
// otel-core/src/config/resolve.ts — must compile and run correctly in BOTH Node and
// a browser bundle. This is enforceable, not just a convention to remember:
export function resolveConfig(
  overrides: Partial<OtelConfig>,
  source: ConfigSource = {},
): OtelConfig {
  return {
    serviceName:
      overrides.serviceName ?? (source.serviceName as string) ?? throwMissingServiceName(),
    endpoint: overrides.endpoint ?? (source.endpoint as string),
    // ... pure data transformation, no fs/http/window/document anywhere in this file
  };
}
```

```js
// .eslintrc — the mechanical enforcement, not just a code-review reminder
{
  "overrides": [{
    "files": ["packages/otel-core/src/**/*.ts"],
    "rules": {
      "no-restricted-imports": ["error", {
        "paths": ["fs", "http", "https", "net", "async_hooks", "child_process"],
        "patterns": ["node:*"]
      }]
    }
  }]
}
```

This only actually stays true over time (as new contributors add code to `otel-core`
without necessarily having read this doc) if it's checked mechanically — a lint rule
that fails CI on a forbidden import, plus the esbuild `platform: browser` smoke
build (see [`../repo-scaffold.md`](../repo-scaffold.md)'s CI outline) — rather than
relying on every future PR reviewer to notice a stray `import fs from 'fs'` in a file
that's supposed to be environment-agnostic.

## 7.6 Sensible defaults, but every default is a config override

Reusability means most services shouldn't need to think about batching parameters,
which propagator to use, or how to construct a `Resource` — good defaults matching
ch. 5/ch. 6's guidance should apply automatically. But "sensible default" and
"hardcoded" are different things: every one of those defaults should be overridable
via the same config mechanism (§7.4), because "sensible for most services" is not
"correct for every service" (a high-throughput service may need a larger batch
queue; a low-traffic internal tool may want 100% sampling even in production).
Similarly, the default instrumentation set (§2.2's auto-instrumentations-node preset,
ch. 3's fetch/XHR/document-load for web) should be a _starting point_, not the only
option — a service using a database library outside the default preset, or wanting
to disable an instrumentation that's too noisy/expensive for its traffic pattern
(ch. 6 §6.1), needs a config-level way to add/remove instrumentations without
forking the wrapper or bypassing it entirely, which is exactly what §7.4's escape
hatch provides.

## 7.7 Testability as a first-class export

If every service that adopts the wrapper has to independently figure out "how do I
assert a span was created with the right attributes in my tests," the wrapper hasn't
actually saved that service any work — it's moved the boilerplate from "SDK setup" to
"test setup."

**Without a shared testing package** — what every service's test suite has to
independently figure out:

```ts
// service A's test file
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
provider.register();

// ... run code under test ...

const spans = exporter.getFinishedSpans();
const match = spans.find(
  (s) => s.name === 'orders.create' && s.attributes['order.total_cents'] === 4200,
);
if (!match)
  throw new Error(
    `Expected span 'orders.create' with order.total_cents=4200, got: ${JSON.stringify(spans.map((s) => s.name))}`,
  );
```

**With a shared testing package** — the payoff, made concrete:

```ts
import { createInMemorySpanExporter, expectSpan } from '@your-org/otel-testing';

const exporter = createInMemorySpanExporter(); // wraps the provider-setup boilerplate above

// ... run code under test ...

expectSpan(exporter.getFinishedSpans(), {
  name: 'orders.create',
  attributes: { 'order.total_cents': 4200 },
}); // one shared, well-tested assertion helper with a good failure message, instead of every service hand-rolling `.find()` + a manual throw
```

A shared `otel-testing` package (this repo's
[`otel-testing` package spec](../package-specs/otel-testing.md)) is what actually
closes that gap instead of just relocating the boilerplate from setup to tests. Note
`SimpleSpanProcessor` is the right choice inside a test's in-memory setup (ch. 5
§5.2) even though it's the wrong choice in production — spans need to be available
for assertion immediately, without waiting on a batch timer.

## 7.8 Versioning discipline as a reusability property, not just a release-process detail

A wrapper used by many services only stays useful if upgrading it is low-risk and
independently scoped per package — a monolithic "everything bumps together" version
scheme means a Node-only bugfix forces every browser-consuming team to also take (and
re-test against) an unrelated release.

```jsonc
// A Node-only bugfix changeset — only otel-node's version bumps
{
  "otel-node": "patch",
}
```

vs. a lockstep scheme where the same fix would force:

```jsonc
{
  "otel-core": "patch",
  "otel-node": "patch",
  "otel-web": "patch", // ← bumped and re-released even though nothing in it changed
  "otel-react": "patch", // ← same
}
```

Concretely, in a lockstep world, every team using `otel-web`/`otel-react` now sees a
new version notification, has to decide whether to upgrade, and — if their CI pins
exact versions rather than ranges — has to actually re-test and redeploy their
frontend for a change that touched zero frontend-relevant code. Independent
versioning (this repo's actual choice, [ADR 0001](../adr/0001-monorepo-without-nx.md))
means that Node bugfix's blast radius is exactly the services that depend on
`otel-node`, and nothing else. This is a _design_ property, not only a tooling
choice — it's the reason the frozen package boundaries
(`otel-core`/`otel-node`/`otel-web`/...) matter: each boundary is also an independent
blast radius for a breaking change.

## 7.9 Edge cases and grey areas checklist

| #   | Scenario                                                                                                                                    | What actually happens                                                                                                                                                                                                                                                                                                                                                                          | Reference |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | A service needs a non-OTLP exporter (e.g. a vendor-proprietary one)                                                                         | Works via the `traceExporter` override escape hatch (§7.4) — the wrapper's opinionated default doesn't block this, but that service's setup diverges from the norm in a way worth documenting in that service's own README, since the wrapper's shared guarantees (consistent batching defaults, etc.) may not all carry over depending on what the custom exporter/processor combination does | §7.4      |
| 2   | A contributor adds a new field to `otel-core`'s config schema that happens to read `process.env` directly "just this once, for convenience" | Passes code review if the reviewer doesn't specifically check for it; only reliably caught by the lint rule + browser-bundle smoke test (§7.5) — a real argument for keeping those checks in CI, not just in a code-review checklist                                                                                                                                                           | §7.5      |
| 3   | A service overrides `instrumentations` entirely (§7.4) and forgets to include `HttpInstrumentation`                                         | That service silently loses all HTTP-level auto-instrumentation, including the wrapper's own sensible defaults — an override replaces, not merges with, the default array                                                                                                                                                                                                                      | §7.4      |
| 4   | Two services' `otel-testing`-based tests both import the same in-memory exporter singleton without resetting between tests                  | Spans from test A leak into test B's assertions — this is exactly why `resetExporters()` (this repo's [otel-testing spec](../package-specs/otel-testing.md)) exists as an explicit, documented `afterEach`/`beforeEach` requirement, not an implementation detail users are expected to intuit                                                                                                 | §7.7      |
| 5   | A package's public API surface changes in a way that isn't backward compatible, but ships as a `patch` changeset by mistake                 | Downstream services taking automatic patch-level upgrades break unexpectedly — the changeset bump level is a human judgment call the tooling can't fully verify; worth a lightweight API-diff check (e.g. `api-extractor` or similar) as a CI backstop if this becomes a recurring mistake, though not necessarily needed from day one                                                         | §7.8      |
