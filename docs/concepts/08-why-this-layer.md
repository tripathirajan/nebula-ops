# 8. Why `@nebula-ops/otel` — synthesis

This is the one chapter that connects the vendor-neutral concepts in §1–§7 back to
this repo's actual package boundaries
([`../architecture.md`](../architecture.md), [`../package-specs/`](../package-specs/)).
If a claim here doesn't trace back to a specific fact in an earlier chapter, that's a
bug in this doc — the point of writing the primer first was to make sure nothing in
the package specs is justified by vibes.

## 8.1 What raw OpenTelemetry does *not* give you for free

Everything in §1–§6 is genuinely vendor-neutral and well-designed — but it is a
**toolkit**, not an **opinionated setup**. Concretely, plain `@opentelemetry/*`
packages leave every one of these as an exercise for each service:

- Deciding and wiring the right `SpanProcessor`/`LogRecordProcessor`/`MetricReader`
  combination and tuning values (§5) — easy to get wrong (e.g. shipping
  `SimpleSpanProcessor` to production, §5.2) with no error or warning from the SDK.
- Building a `Resource` with the org's actual semantic-convention attributes
  consistently spelled the same way across every service (§1.10) — nothing stops two
  services from calling the same concept `env` and `environment` respectively.
- Picking and correctly installing the right `ContextManager` per environment
  (§2.3, §3.3) — a config detail with a real, silent failure mode (logs/spans losing
  correlation) if skipped or misconfigured.
- Choosing a sampling strategy and ratio, and knowing that ratio needs to be
  `ParentBased` to stay trace-complete across services (§1.6) — an easy mistake with
  no compile-time signal that it's wrong.
- Writing the log-correlation glue for whichever logger a given service happens to
  use (§4) — genuinely different code per logger (pino mixin vs winston format vs
  console wrapping), rewritten from scratch by whoever adopts OTel next.
- Building (or finding) in-memory-exporter test helpers (§7.6) — otherwise each team
  reinvents "how do I assert a span was recorded."

None of this is OTel being poorly designed — it's OTel being a spec-driven,
vendor-neutral toolkit, which by nature has to stay unopinionated about all of the
above. **Filling in the opinions, once, consistently, is exactly what a thin org
wrapper is for.**

## 8.2 What the wrapper deliberately does *not* try to change

Per §7.2 and §7.7, the wrapper is not meant to hide OTel or invent a parallel API:

- `@opentelemetry/api` stays the peer dependency every package builds on (§1.8) —
  application code that needs to drop to raw OTel API calls (create a manual span,
  read `trace.getSpan(context.active())` directly) can always do so; the wrapper adds
  convenience, it doesn't gate access.
- Signal semantics (what a span/metric/log *is*, §1.1–§1.4) are untouched — the
  wrapper configures pipelines, it doesn't redefine what a trace means.
- The Collector-vs-direct-export decision (§1.9) stays a deployment/infra choice, not
  something baked into the wrapper — `endpoint`/`headers` are config, not hardcoded.

## 8.3 Mapping concepts to package boundaries

| Concept from §1–§7 | Where it lands in this repo |
|---|---|
| Resource building, semantic-convention attribute constants (§1.10) | `otel-core` — environment-agnostic by construction (§7.3), since building a `Resource` object needs no Node/browser-specific API |
| Config schema + env-var/precedence resolution (§7.1) | `otel-core` — same reasoning; the *values* differ per environment, the *shape*/*resolution logic* doesn't |
| Log-context correlation primitives (`LogContext`, `getActiveLogContext`) (§4.4) | `otel-core` — reads the OTel `context` API, which is itself environment-agnostic (§1.5); only the *ContextManager installation* is environment-specific |
| `AsyncLocalStorageContextManager` installation (§2.3) | `otel-node` only — this is the Node-specific half of context propagation |
| `ZoneContextManager`/`StackContextManager` installation, CORS trace-header allow-list (§3.3, §3.4) | `otel-web` only — the browser-specific half, plus a browser-only safety concern (§3.4) with no Node equivalent |
| `NodeSDK` assembly, auto-instrumentations-node, OTLP exporters, pino/winston bindings (§2, §4.1 Pattern A) | `otel-node` |
| `WebTracerProvider` assembly, fetch/XHR/document-load instrumentation, web-vitals bridge, console bridge (§3, §4.1 Pattern A) | `otel-web` |
| Sensible `BatchSpanProcessor`/`BatchLogRecordProcessor` defaults with overridable tuning (§5.2, §7.4) | Defaults live in `otel-node`/`otel-web` (each environment's own default exporter/processor factories), because the exporter transport itself is environment-specific (§2.4 vs §3.5) even though the *concept* is shared |
| Sampling ratio as config, `ParentBased(TraceIdRatioBased(...))` as default (§1.6, §6.2) | `NebulaOtelConfig.sampling.ratio`, resolved in `otel-core`, applied when each environment package constructs its `TracerProvider` |
| In-memory exporters + assertion helpers (§7.6) | `otel-testing` — deliberately graph-neutral (§7.6's "shouldn't be per-service work" applies equally regardless of Node vs web) |
| React-specific ergonomics (route-change spans, error boundary → span events) | `otel-react` — this is new surface area OTel itself has no opinion on at all (no signal/concept in §1–§6 corresponds to "route change"); it's pure convenience on top of `otel-web`'s tracer |

## 8.4 Why the specific `otel-node`/`otel-web`-never-depend-on-each-other rule exists

This isn't an arbitrary constraint — it falls directly out of §3.1: Node and browser
solve context propagation, instrumentation mechanics, and export transport in
*fundamentally different ways* (module-patching vs global-patching,
AsyncLocalStorage vs Zone/Stack, OTLP/gRPC-or-HTTP vs OTLP/HTTP-only). There is no
correct shared code between them beyond what's already environment-agnostic and
therefore already belongs in `otel-core`. A dependency from one to the other would
either be dead weight (bundling Node-only code into a browser bundle, or vice versa)
or a sign that something environment-agnostic was incorrectly placed in the wrong
package instead of promoted to `otel-core`.

## 8.5 Why performance/cardinality guidance (§6) belongs in docs, not just code

Sampling ratio and batch tuning are exposed as config (§6.2, §6.4) because they're
genuine per-service trade-offs the wrapper can't correctly choose on a service's
behalf (§7.4) — but **cardinality discipline (§6.3) is a call-site convention, not a
config knob**: no wrapper-level setting can retroactively fix a service that put
`user_id` on a metric attribute. This is why cardinality guidance belongs in this
repo's documentation/examples (and possibly a lint rule flagging obviously
high-cardinality attribute names on metric calls, worth considering during
implementation) rather than being something `otel-core`'s config schema can enforce
structurally.

## 8.6 Open questions this primer surfaces for Phase 1 review

These aren't blocking, but are worth explicit sign-off given what §1–§7 revealed:

1. **Zone.js for `otel-web`'s default `ContextManager`?** §3.3 lays out the real
   trade-off (Zone = more complete but a global-patching dependency, especially sharp
   for Angular consumers; Stack = lighter but loses context in unwrapped async code).
   [`../package-specs/otel-web.md`](../package-specs/otel-web.md) currently defaults
   to Zone with Stack fallback — confirm that's still the right default now that the
   trade-off is explicit, or flip the default to Stack with Zone opt-in.
2. **Tail-based sampling** (§1.6) is explicitly a Collector-level concern, not
   something `otel-core`'s `sampling.ratio` config can express. Worth confirming the
   Collector deployment (out of scope for this repo's code, but referenced by
   `endpoint` config) is expected to exist, since "always keep error traces" isn't
   otherwise achievable.
3. **Logs pattern choice** (§4.1/§4.2): the package specs currently build Pattern A
   (correlation-only, via pino mixin / winston format / console bridge) as the
   default, with `@opentelemetry/sdk-logs` present as a dependency mainly for
   `otel-testing`'s in-memory log exporter and `otel-web`'s optional log-record
   emission. Confirm Pattern A-by-default (not B) is the intended scope for M1–M3,
   with Pattern B treated as a possible later addition rather than something M1–M3
   silently need to half-support.
