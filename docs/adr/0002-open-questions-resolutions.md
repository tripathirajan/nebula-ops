# ADR 0002: Resolutions to the 9 open questions from the concepts primer

## Status

Accepted — 2026-08-15. **Author's note:** these decisions were made autonomously
(user unavailable to review in real time) so Phase 2 implementation could proceed
without stalling. Every decision below is reversible — flagged explicitly where a
later reversal would be a breaking API change vs. a config-default tweak. Revisit at
the next check-in.

## Context

[`../concepts/08-why-this-layer.md`](../concepts/08-why-this-layer.md) §8.6 raised 9
open questions surfaced by the tutorial-depth expansion of the OTel concepts primer.
Implementation (M0 onward) needs a settled answer to each before writing code against
the package specs, since several bear directly on default behavior or exported API
shape.

## Decisions

### 1. `otel-web`'s default `ContextManager`: **Stack, not Zone**

**Decision:** `StackContextManager` is the default; `ZoneContextManager` is available
via the `contextManager` override (already part of the frozen `otel-web` API surface,
[`../package-specs/otel-web.md`](../package-specs/otel-web.md)).

**Reasoning:** `otel-web` is a general-purpose library with no visibility into
whether a consuming app is Angular (where Zone.js version/instance conflicts are a
documented real risk, [ch. 3 §3.4](../concepts/03-otel-web.md#34-context-propagation-zone-vs-stack-with-actual-code-and-actual-failure-cases))
or not. Defaulting to the option with a known cross-framework conflict risk, on
behalf of every consumer, is the wrong default for a shared package — Stack's failure
mode (silently losing context in hand-written async code the SDK doesn't wrap) is
real but bounded, discoverable via the edge-case checklist, and doesn't add a new
runtime dependency (`zone.js`) to every consumer's bundle by default. Angular teams
(or anyone who wants maximal automatic coverage) opt in explicitly.

**Reversibility:** config-default change, not a breaking API change — the
`contextManager` override already existed in the spec either way.

**Action taken:** updated [`../package-specs/otel-web.md`](../package-specs/otel-web.md)'s
default description.

### 2. Tail-based sampling / Collector deployment assumption

**Decision:** this repo's code assumes a Collector sits downstream of every
service's OTLP `endpoint` in production, and does **not** attempt to replicate
tail-sampling logic in `otel-core`/`otel-node`/`otel-web`. `otel-core`'s
`sampling.ratio` config defaults to `1.0` (100%, i.e. `AlwaysOn`-equivalent via
`ParentBased(TraceIdRatioBased(1.0))`) rather than guessing a production-appropriate
ratio, since this is a new project with no established traffic baseline to size a
default against, and because sampling generously at the SDK level is a prerequisite
for a downstream Collector tail-sampling policy to work correctly
([ch. 6 §6.3](../concepts/06-performance-and-optimization.md#63-tail-based-sampling--where-it-actually-lives)).
Each service is expected to override `sampling.ratio` deliberately once its traffic
volume is known.

**Reversibility:** config-default change.

**Action taken:** documented explicitly in
[`../architecture.md`](../architecture.md)'s config table (endpoint assumes a
Collector or OTLP-compatible backend is reachable; not re-litigated per-package).

### 3. Logs pattern scope for M1–M3: **Pattern A only**

**Decision:** confirmed as already spec'd — Pattern A (correlation-only: pino mixin /
winston format / console bridge) is the only logging integration built in M1–M3.
Pattern B (Logs Bridge, `@opentelemetry/sdk-logs` + `instrumentation-pino`) is
explicitly deferred, not half-implemented. `otel-node`/`otel-web` still depend on
`@opentelemetry/sdk-logs` per their package specs, but only for `otel-testing`'s
in-memory log exporter and `otel-web`'s optional log-record emission — not for a
Pattern B pipeline.

**Reversibility:** none needed — no change, just confirmation.

### 4. `otel-node`'s default instrumentation set: **full meta-package**

**Decision:** `startNodeSdk`'s default `instrumentations` is
`getNodeAutoInstrumentations()` unmodified (the full ~40+ library set), not a
curated subset. Matches upstream's own default, is the least surprising choice for
anyone familiar with plain OTel Node setup, and the fixed startup/dependency-weight
cost ([ch. 2 §2.2](../concepts/02-otel-node.md#22-auto-instrumentation-what-actually-happens-when-a-library-isnt-in-use))
is small in absolute terms for the long-lived-server target this package is scoped
to (FaaS/CLI cold-start sensitivity is an explicit non-goal per the package specs).
Services that want to trim it use the documented per-instrumentation `{ enabled:
false }` pattern or the `instrumentations` override.

**Reversibility:** config-default change.

**Action taken:** added this as an explicit line in
[`../package-specs/otel-node.md`](../package-specs/otel-node.md).

### 5. `enhancedDatabaseReporting` / Redis argument capture: **not exposed as a passthrough**

**Decision:** `otel-node`'s public config surface (`NebulaNodeSdkOptions`) does
**not** provide a first-class way to turn on `enhancedDatabaseReporting` or
verbatim Redis command-argument capture. A service that genuinely needs it must
construct its own `PgInstrumentation`/`RedisInstrumentation` instance directly and
pass it via the `instrumentations` override (already part of the frozen API surface)
— a deliberate, visible, one-line opt-in at the call site rather than a config flag
that's one keystroke away from being flipped on by habit.

**Reversibility:** this is an omission (no export added), not a breaking change if
reversed later by adding an explicit, prominently-named opt-in
(e.g. `dangerouslyEnableVerboseDbReporting`) — reversal only ever adds surface, never
removes it.

**Action taken:** added to `otel-node`'s non-goals in
[`../package-specs/otel-node.md`](../package-specs/otel-node.md).

### 6. Redis pub/sub trace propagation: **explicit non-goal**

**Decision:** `otel-node` does not attempt to bridge trace context across Redis
pub/sub ([ch. 2 §2.6](../concepts/02-otel-node.md#26-outbound-calls--httpdbredis-client-spans)).
No standard upstream instrumentation does this either, so building it would be
net-new, non-standard code this repo would own indefinitely. If a consuming service
needs it, the pattern (manual `SpanContext` serialization into the message payload) is
documented in ch. 2 §2.6 for them to implement themselves.

**Action taken:** added to `otel-node`'s non-goals in
[`../package-specs/otel-node.md`](../package-specs/otel-node.md).

### 7. Message-queue consumer context-scoping: **documented pattern, no dedicated code**

**Decision:** for M1–M3, `otel-node` ships no message-queue-specific helpers (no
Kafka/AMQP wrapper). The `context.with()`-per-message pattern
([ch. 2 §2.7](../concepts/02-otel-node.md#27-inboundoutbound-for-message-queues--the-pattern-that-breaks-naive-assumptions))
stays documentation-only. Revisit only if/when a concrete consuming service's
message-queue usage justifies the added maintenance surface — no service in this
repo's examples currently needs it.

**Action taken:** no package-spec change needed (already correctly scoped out).

### 8. ESM support: **CJS is the verified target; ESM is best-effort/undocumented for M1–M3**

**Decision:** `otel-node`'s test suite and CI target CommonJS output only for M1–M3.
ESM consumers may work (the package ships ESM build output via `tsup`'s dual
CJS+ESM output per the repo scaffold), but the loader-hook requirement for
auto-instrumentation under ESM ([ch. 2 §2.9](../concepts/02-otel-node.md#29-esm--a-genuinely-different-mechanism-not-just-a-syntax-change))
is not verified in CI and is not a support commitment at this stage.

**Reversibility:** verification can be added later (a follow-up CI job) without any
breaking change to the package itself.

**Action taken:** added an explicit compatibility note to
[`../package-specs/otel-node.md`](../package-specs/otel-node.md)'s non-goals.

### 9. SSR/hydration trace-context bridging: **explicit non-goal for `otel-react` v1**

**Decision:** `otel-react`'s M4 scope does not include an SSR/hydration bridging
helper (no `traceparent`-meta-tag reader shipped). This is real, distinct design
surface ([ch. 9 §9.8](../concepts/09-otel-web-in-react.md#98-server-side-rendering-and-hydration--otel-web-is-browser-only-and-the-handoff-is-a-real-gap))
specific to SSR frameworks, and `otel-react` is already a stretch-goal package —
adding SSR-bridging scope to it risks it not shipping at all. Consuming apps needing
this implement the pattern documented in ch. 9 §9.8 directly.

**Action taken:** added to `otel-react`'s non-goals in
[`../package-specs/otel-react.md`](../package-specs/otel-react.md).

## Consequences

- Implementation can proceed against the package specs without further blocking on
  design questions.
- Every decision above is flagged for revisit — none are treated as permanently
  closed, since they were made without the user's real-time input. See
  [`../governance/ai-contribution-policy.md`](../governance/ai-contribution-policy.md)
  for how autonomously-made decisions like these are expected to be surfaced and
  re-reviewed.
