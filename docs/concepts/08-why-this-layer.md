# 8. Why `@nebula-ops/otel` — synthesis

This is the one chapter that connects the vendor-neutral concepts in ch. 1–7 back to
this repo's actual package boundaries
([`../architecture.md`](../architecture.md), [`../package-specs/`](../package-specs/)).
If a claim here doesn't trace back to a specific fact in an earlier chapter, that's a
bug in this doc — the point of writing the primer first was to make sure nothing in
the package specs is justified by vibes.

**Revision note:** chapters 2–7 were expanded from overview depth to tutorial depth
(runnable-shape code, official doc links, edge-case checklists) after this chapter
was first written. Section references below have been checked against that expanded
numbering; if you're cross-referencing an older discussion that cited a section
number from before the expansion, re-check it against the current chapter — several
numbers shifted.

## 8.1 What raw OpenTelemetry does *not* give you for free

Everything in §1–§6 is genuinely vendor-neutral and well-designed — but it is a
**toolkit**, not an **opinionated setup**. Concretely, plain `@opentelemetry/*`
packages leave every one of these as an exercise for each service:

- Deciding and wiring the right `SpanProcessor`/`LogRecordProcessor`/`MetricReader`
  combination and tuning values (ch. 5) — easy to get wrong (e.g. shipping
  `SimpleSpanProcessor` to production, ch. 5 §5.2) with no error or warning from the SDK.
- Building a `Resource` with the org's actual semantic-convention attributes
  consistently spelled the same way across every service (ch. 1 §1.10) — nothing
  stops two services from calling the same concept `env` and `environment`
  respectively, exactly as happens in ch. 7 §7.1's concrete copy-paste example.
- Picking and correctly installing the right `ContextManager` per environment
  (ch. 2 §2.3, ch. 3 §3.4) — a config detail with a real, silent failure mode
  (logs/spans losing correlation) if skipped or misconfigured.
- Deciding which auto-instrumentations to enable/disable per service, and staying
  aware that a library version bump can silently stop producing spans with no error
  (ch. 2 §2.2–§2.3) — not a one-time setup decision but an ongoing maintenance
  surface with no compile-time signal when it drifts.
- Handling inbound/outbound span shape correctly for non-HTTP call patterns —
  message-queue consumer loops in particular need explicit per-message context
  scoping or spans/log-context bleed across unrelated messages (ch. 2 §2.7).
- Choosing a sampling strategy and ratio, and knowing that ratio needs to be
  `ParentBased` to stay trace-complete across services (ch. 1 §1.6, ch. 6 §6.2) — an
  easy mistake with no compile-time signal that it's wrong.
- Writing the log-correlation glue for whichever logger a given service happens to
  use (ch. 4) — genuinely different code per logger (pino mixin vs winston format vs
  console wrapping), rewritten from scratch by whoever adopts OTel next.
- Building (or finding) in-memory-exporter test helpers (ch. 7 §7.7) — otherwise each
  team reinvents "how do I assert a span was recorded."

None of this is OTel being poorly designed — it's OTel being a spec-driven,
vendor-neutral toolkit, which by nature has to stay unopinionated about all of the
above. **Filling in the opinions, once, consistently, is exactly what a thin org
wrapper is for.**

## 8.2 What the wrapper deliberately does *not* try to change

Per ch. 7 §7.3 and §7.7, the wrapper is not meant to hide OTel or invent a parallel API:

- `@opentelemetry/api` stays the peer dependency every package builds on (ch. 1
  §1.8) — application code that needs to drop to raw OTel API calls (create a manual
  span per ch. 2 §2.4, read `trace.getSpan(context.active())` directly) can always do
  so; the wrapper adds convenience, it doesn't gate access.
- Signal semantics (what a span/metric/log *is*, ch. 1 §1.1–§1.4) are untouched — the
  wrapper configures pipelines, it doesn't redefine what a trace means.
- The Collector-vs-direct-export decision (ch. 1 §1.9) stays a deployment/infra
  choice, not something baked into the wrapper — `endpoint`/`headers` are config, not
  hardcoded.

## 8.3 Mapping concepts to package boundaries

| Concept from §1–§7 | Where it lands in this repo |
|---|---|
| Resource building, semantic-convention attribute constants (ch. 1 §1.10) | `otel-core` — environment-agnostic by construction (ch. 7 §7.5), since building a `Resource` object needs no Node/browser-specific API |
| Config schema + env-var/precedence resolution (ch. 7 §7.2) | `otel-core` — same reasoning; the *values* differ per environment, the *shape*/*resolution logic* doesn't |
| Log-context correlation primitives (`LogContext`, `getActiveLogContext`) (ch. 4 §4.4) | `otel-core` — reads the OTel `context` API, which is itself environment-agnostic (ch. 1 §1.5); only the *ContextManager installation* is environment-specific |
| `AsyncLocalStorageContextManager` installation, auto-instrumentation unused-library/version-compatibility behavior (ch. 2 §2.2–§2.3) | `otel-node` only — this is the Node-specific half of context propagation |
| `ZoneContextManager`/`StackContextManager` installation, CORS trace-header allow-list, public-endpoint/payload-budget posture (ch. 3 §3.4, §3.5, §3.10) | `otel-web` only — the browser-specific half, plus browser-only safety/cost concerns with no Node equivalent |
| `NodeSDK` assembly, auto-instrumentations-node (with explicit disable list, ch. 2 §2.2), OTLP exporters, pino/winston bindings (ch. 2, ch. 4 §4.5–§4.6) | `otel-node` |
| Inbound/outbound span shapes for HTTP, DB, Redis, message queues (ch. 2 §2.5–§2.7) | `otel-node` only — the browser has no inbound/"server" role at all (ch. 3 §3.6); `otel-web` only ever produces outbound `CLIENT` spans |
| `WebTracerProvider` assembly, fetch/XHR/document-load instrumentation, web-vitals bridge, console bridge (ch. 3, ch. 4 §4.7) | `otel-web` |
| Sensible `BatchSpanProcessor`/`BatchLogRecordProcessor` defaults with overridable tuning (ch. 5 §5.2, ch. 7 §7.6) | Defaults live in `otel-node`/`otel-web` (each environment's own default exporter/processor factories), because the exporter transport itself is environment-specific (OTLP/gRPC-or-HTTP in Node vs OTLP/HTTP-only in the browser, ch. 3 §3.10) even though the *concept* is shared |
| Sampling ratio as config, `ParentBased(TraceIdRatioBased(...))` as default (ch. 1 §1.6, ch. 6 §6.2) | `NebulaOtelConfig.sampling.ratio`, resolved in `otel-core`, applied when each environment package constructs its `TracerProvider` |
| Cardinality-safe metric-attribute guidance (ch. 6 §6.4) | Not a config knob anywhere — a call-site convention documented for consumers, see §8.5 below |
| In-memory exporters + assertion helpers (ch. 7 §7.7) | `otel-testing` — deliberately graph-neutral (ch. 7 §7.7's "shouldn't be per-service work" applies equally regardless of Node vs web) |
| React-specific ergonomics (route-change spans, error boundary → span events) | `otel-react` — this is new surface area OTel itself has no opinion on at all (no signal/concept in ch. 1–6 corresponds to "route change"); it's pure convenience on top of `otel-web`'s tracer |

## 8.4 Why the specific `otel-node`/`otel-web`-never-depend-on-each-other rule exists

This isn't an arbitrary constraint — it falls directly out of ch. 3 §3.1: Node and
browser solve context propagation, instrumentation mechanics, and export transport in
*fundamentally different ways* (module-patching vs global-patching,
AsyncLocalStorage vs Zone/Stack, OTLP/gRPC-or-HTTP vs OTLP/HTTP-only, and — per ch. 3
§3.6 — Node has an inbound/`SERVER`-span role the browser structurally doesn't).
There is no correct shared code between them beyond what's already
environment-agnostic and therefore already belongs in `otel-core`. A dependency from
one to the other would either be dead weight (bundling Node-only code into a browser
bundle, or vice versa) or a sign that something environment-agnostic was incorrectly
placed in the wrong package instead of promoted to `otel-core`.

## 8.5 Why performance/cardinality guidance (ch. 6) belongs in docs, not just code

Sampling ratio and batch tuning are exposed as config (ch. 6 §6.2, §6.5) because
they're genuine per-service trade-offs the wrapper can't correctly choose on a
service's behalf (ch. 7 §7.6) — but **cardinality discipline (ch. 6 §6.4) is a
call-site convention, not a config knob**: no wrapper-level setting can retroactively
fix a service that put `user_id` on a metric attribute (ch. 6 §6.4's concrete
mistake-and-fix example). This is why cardinality guidance belongs in this repo's
documentation/examples (and possibly a lint rule flagging obviously
high-cardinality attribute names on metric calls, worth considering during
implementation) rather than being something `otel-core`'s config schema can enforce
structurally. The same logic extends to two things ch. 2's expansion surfaced that
weren't explicit before: **PII risk in DB/Redis instrumentation attributes**
(`enhancedDatabaseReporting`, Redis command-argument serialization — ch. 2 §2.6)
and **auto-instrumentation version-compatibility drift** (ch. 2 §2.3) are both
call-site/upgrade-time disciplines, not something a config schema can structurally
prevent — worth the same documentation-and-code-review treatment as cardinality,
and worth naming explicitly in service onboarding docs when this repo reaches
implementation.

## 8.6 Open questions this primer surfaces for Phase 1 review

These aren't blocking, but are worth explicit sign-off given what ch. 1–7 revealed.
Items 1–3 carried over from the original pass; 4–8 are new, surfaced by the
tutorial-depth expansion of ch. 2–7.

1. **Zone.js for `otel-web`'s default `ContextManager`?** Ch. 3 §3.4 lays out the
   real trade-off, with a concrete failure example each way (Zone = more complete
   but a global-patching dependency, especially sharp for Angular consumers; Stack =
   silently loses context in unwrapped async code like a raw `setTimeout`).
   [`../package-specs/otel-web.md`](../package-specs/otel-web.md) currently defaults
   to Zone with Stack fallback — confirm that's still the right default now that the
   trade-off is explicit, or flip the default to Stack with Zone opt-in.
2. **Tail-based sampling** (ch. 1 §1.6, ch. 6 §6.3) is explicitly a Collector-level
   concern, not something `otel-core`'s `sampling.ratio` config can express. Worth
   confirming the Collector deployment (out of scope for this repo's code, but
   referenced by `endpoint` config) is expected to exist, since "always keep error
   traces" isn't otherwise achievable — and per ch. 6 §6.3, SDK-level sampling needs
   to be set generously if a Collector tail-sampling policy is relied on, which has
   implications for `otel-core`'s default `sampling.ratio` value.
3. **Logs pattern choice** (ch. 4 §4.1/§4.2): the package specs currently build
   Pattern A (correlation-only, via pino mixin / winston format / console bridge) as
   the default, with `@opentelemetry/sdk-logs` present as a dependency mainly for
   `otel-testing`'s in-memory log exporter and `otel-web`'s optional log-record
   emission. Confirm Pattern A-by-default (not B) is the intended scope for M1–M3,
   with Pattern B (ch. 4 §4.8) treated as a possible later addition rather than
   something M1–M3 silently needs to half-support.
4. **Which auto-instrumentations does `otel-node`'s default set actually include,
   and how is the "not in use" case documented per-consumer?** Ch. 2 §2.2 shows the
   full meta-package carries real (if small) fixed startup cost and dependency
   weight regardless of use. Worth deciding whether `otel-node`'s default is the
   full `getNodeAutoInstrumentations()` set (simplest, matches upstream default) or
   a curated subset with documented opt-in for the rest — and either way, the
   `otel-node` package spec should say explicitly which posture it takes, since it
   currently doesn't.
5. **`enhancedDatabaseReporting`/Redis command-argument capture — hard-disabled or
   just defaulted off?** Ch. 2 §2.6 flags this as a real PII/secret exposure risk.
   Worth deciding whether `otel-node` merely leaves the upstream default (off) as-is,
   or actively prevents a consuming service from turning it on via `otel-node`'s own
   config surface — the latter is a stronger guarantee worth considering given this
   repo's "no package publishes secrets/tokens" constraint, even though this is
   about span attributes rather than package-level secrets.
6. **Redis pub/sub and any other non-request/response infra `otel-node` might touch
   — explicitly out of scope, or a future custom-instrumentation target?** Ch. 2
   §2.6 notes there's no standard trace-context propagation over Redis pub/sub.
   [`../package-specs/otel-node.md`](../package-specs/otel-node.md) doesn't currently
   mention this — worth an explicit non-goal line there if it's staying out of scope,
   so it isn't discovered as a surprise gap later.
7. **Message-queue consumer context-scoping — does `otel-node` need to document or
   provide the `context.with()`-per-message pattern (ch. 2 §2.7), or is that left
   entirely to whichever queue instrumentation a consuming service pulls in?** Given
   the failure mode (context bleeding across messages in hand-rolled consumer loops)
   is easy to hit silently, this may be worth a documented pattern/example even if
   `otel-node` itself doesn't ship queue-specific code.
8. **ESM support verification (ch. 2 §2.9) — does this repo commit to verifying
   ESM compatibility for the specific instrumentations `otel-node` defaults to, or
   document CJS as the only supported mode for M1–M3?** This wasn't previously
   surfaced as a decision point; worth an explicit line in
   [`../package-specs/otel-node.md`](../package-specs/otel-node.md) either way,
   since "should work under ESM" and "verified to work under ESM" are different
   claims and the gap between them is exactly where this kind of bug hides.
