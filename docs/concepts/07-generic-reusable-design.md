# 7. What makes an OTel wrapper generic and reusable (vs per-service boilerplate)

This chapter is still about general principles — not `@nebula-ops` specifics — but
framed toward "what would make *any* org's OTel wrapper actually reusable across many
services," since that's the property Phase 1's package specs are trying to achieve.

## 7.1 Config-driven, not code-driven, per-service variation

Every service needs the *same shape* of setup (Resource, exporter, sampler, context
manager, instrumentation set) with *different values* (service name, endpoint,
sampling ratio, which instrumentations apply). A reusable wrapper's job is to make
that variation entirely a config problem, not a code problem — a new service should
be able to get fully-configured telemetry by supplying a config object/env vars, not
by writing SDK-assembly code. This is the core reason a shared config schema
(§ config shape discussion in [`../architecture.md`](../architecture.md)) is worth
owning centrally rather than letting each service hand-roll its own `NodeSDK(...)`
call with slightly different options.

## 7.2 Depend on the API, implement against the SDK, expose neither raw

Per §1.8, application/library code should only ever need `@opentelemetry/api` types.
A reusable wrapper sits *between* the raw SDK (which it configures) and application
code (which it hands a simplified surface to) — this means:

- The wrapper's public exports should be small, opinionated functions
  (`startNodeSdk(config)`, not "here are 15 SDK classes, assemble them yourself").
- Where the wrapper *does* re-export raw OTel API pieces (`trace`, `context`), it
  should be exactly the API package's own exports, not a modified/renamed version —
  so application code written against "the OTel API" isn't secretly locked into a
  wrapper-specific dialect that diverges from OTel docs/examples/community knowledge.
- Escape hatches matter: a config option to supply a custom exporter/sampler/processor
  (rather than only the wrapper's defaults) keeps the wrapper from becoming a ceiling
  on what a service can do when its needs genuinely diverge from the default.

## 7.3 Environment-specific code stays out of the shared core

If the same config schema, resource-building logic, and log-context helpers are
useful in both Node and browser contexts, that logic has to be written so it
literally cannot accidentally import something environment-specific (§1.8's API/SDK
split, applied one level further: environment-agnostic-core vs environment-specific
adapters, not just app-vs-SDK). This is what makes the shared piece actually shared,
rather than "shared in theory, but silently Node-only because someone imported `fs`
once." Verifying this mechanically (bundler smoke test, import-restriction lint) is
worth doing rather than trusting code review alone to catch a violation.

## 7.4 Sensible defaults, but every default is a config override

Reusability means most services shouldn't need to think about batching parameters,
which propagator to use, or how to construct a `Resource` — good defaults matching
§5/§6's guidance should apply automatically. But "sensible default" and "hardcoded"
are different things: every one of those defaults should be overridable via the same
config mechanism, because "sensible for most services" is not "correct for every
service" (a high-throughput service may need a larger batch queue; a low-traffic
internal tool may want 100% sampling even in production).

## 7.5 Don't force one instrumentation set on everyone

A reusable wrapper's default instrumentation set (auto-instrumentations-node preset,
fetch/XHR/document-load for web) should be a *starting point*, not the only option —
a service using a database library outside the default preset, or wanting to disable
an instrumentation that's too noisy/expensive for its traffic pattern (§6.1), needs a
config-level way to add/remove instrumentations without forking the wrapper or
bypassing it entirely.

## 7.6 Testability as a first-class reusability property

If every service that adopts the wrapper has to independently figure out "how do I
assert a span was created with the right attributes in my tests," the wrapper hasn't
actually saved that service any work — it's moved the boilerplate from "SDK setup"
to "test setup." A reusable design treats in-memory exporters and assertion helpers
as part of the package, not an exercise left to each consuming team (this is the
whole reason a dedicated testing-helpers package is worth having as its own
deliverable, not just "use `@opentelemetry/sdk-trace-base` directly and figure it
out" per service).

## 7.7 Versioning discipline as a reusability property, not just a release-process detail

A wrapper used by many services only stays useful if upgrading it is low-risk and
independently scoped per package — a monolithic "everything bumps together" version
scheme means a Node-only bugfix forces every browser-consuming team to also take (and
re-test against) an unrelated release. This is a *design* property, not only a
tooling choice — it's the reason the frozen package boundaries
(`otel-core`/`otel-node`/`otel-web`/...) matter: each boundary is also an independent
blast radius for a breaking change.

## 7.8 The failure mode this all guards against

Without these properties, what typically happens in practice: team A copies team B's
`NodeSDK` setup code into a new service, tweaks a few values, and now there are two
near-identical-but-subtly-different OTel configs in the org, each independently prone
to drift (different batching defaults, different resource attribute names, different
sampling ratios chosen ad hoc) — and nobody can safely make an org-wide change (e.g.
"add a new mandatory resource attribute for the new observability backend migration")
without touching every service's copy-pasted setup individually. A generic, reusable
package is what turns that into a single version bump.
