# Implementation plan — @nebula-ops/otel

Milestones are ordered and each ends with an explicit stop-and-check-in point per the
project's Phase 2 instructions: after each milestone, run build + lint + tests for the
packages touched, report pass/fail, and pause for review before starting the next
milestone.

Complexity key: **S** = well under a day of focused work, **M** = roughly a day,
**L** = multiple days / meaningfully open-ended.

---

## M0 — Repo scaffold

**Goal:** empty-but-wired monorepo shell exists; tooling runs green on nothing.

**Acceptance criteria:**

- `pnpm install` succeeds at the repo root.
- `pnpm turbo run build lint typecheck test` succeeds (trivially, with zero packages
  or with placeholder packages producing no output) with no errors.
- `pnpm changeset` runs without error (Changesets config initialized).
- CI workflow (`ci.yml`) triggers and passes on a no-op PR.
- Directory tree matches [`docs/repo-scaffold.md`](repo-scaffold.md) §1.

**Files touched:**

- `pnpm-workspace.yaml`, `turbo.json`, root `package.json`, `tsconfig.base.json`,
  `.npmrc`, `.gitignore`, `README.md`
- `.changeset/config.json`
- `.github/workflows/ci.yml`, `.github/workflows/release.yml`
- Empty `packages/*` directories are **not** created yet in M0 — only the workspace
  plumbing. (First real package directory arrives in M1.)

**Complexity:** S

**Stop and check in:** confirm CI is green on the scaffold-only PR before writing any
package code.

---

## M1 — `otel-core`

**Goal:** `otel-core` implemented to the frozen spec in
[`docs/package-specs/otel-core.md`](package-specs/otel-core.md), environment-agnostic
constraint verified in CI.

**Acceptance criteria:**

- All exports in the package spec exist with matching signatures.
- Unit tests cover: config resolution precedence (overrides > source > defaults),
  `validateConfig` error paths, `buildResource` attribute merging, `runWithLogContext`/
  `getActiveLogContext`/`bindLogContext` behavior against a stub `ContextManager`.
- ESLint `no-restricted-imports` rule blocking Node builtins/browser globals is active
  on `packages/otel-core/src` and passes.
- esbuild `platform: browser` smoke build of `otel-core` succeeds in CI.
- `pnpm turbo run build lint typecheck test --filter=@nebula-ops/otel-core` all pass.
- A changeset is added for `otel-core`'s initial `0.1.0` release.

**Files touched:**

- `packages/otel-core/**` (full package per [`docs/repo-scaffold.md`](repo-scaffold.md) §1)
- `.changeset/*.md` (new changeset file)
- Possibly: shared ESLint config additions at repo root for the import-restriction rule.

**Complexity:** M

**Stop and check in:** this is the foundation every other package builds on — get
explicit sign-off that the frozen API surface still looks right in practice (real
signatures, not just the spec) before starting `otel-node`/`otel-web`.

---

## M2 — `otel-node`

**Goal:** `otel-node` implemented to the frozen spec in
[`docs/package-specs/otel-node.md`](package-specs/otel-node.md), depending only on
`otel-core`.

**Acceptance criteria:**

- All exports in the package spec exist with matching signatures.
- `startNodeSdk`/`shutdownNodeSdk`/`registerShutdownHandlers` verified against an
  in-process OTLP-compatible test collector or upstream in-memory exporters (final
  choice made if/when `otel-testing` isn't ready yet — see note below).
- `AsyncLocalStorageContextManager` installation verified: a log line emitted inside
  an async call chain picks up the correct trace/span id via `createPinoMixin`/
  `createWinstonFormat`.
- No import of any `otel-web` or browser-only package (checked by the same
  dependency-graph lint rule extended to enforce the "never depend on each other"
  rule from [`docs/architecture.md`](architecture.md)).
- `pnpm turbo run build lint typecheck test --filter=@nebula-ops/otel-node` all pass.
- A changeset is added for `otel-node`'s initial `0.1.0` release.

**Files touched:**

- `packages/otel-node/**`
- `.changeset/*.md`

**Note:** if `otel-testing` (M4) isn't built yet, M2's own tests use
`@opentelemetry/sdk-trace-base`'s `InMemorySpanExporter` directly rather than blocking
on the stretch package — matches `otel-testing`'s documented fallback in its spec's
non-goals.

**Complexity:** L (SDK wiring + two logger integrations + async-context verification)

**Stop and check in:** demonstrate a minimal script that starts the SDK, makes a
traced call, and shows a log line with matching trace id, before moving to `otel-web`.

---

## M2.5 — `otel-fastify` (added mid-implementation, not in the original M0–M5 plan)

**Goal:** a Fastify plugin, built on `otel-node`, per
[`docs/package-specs/otel-fastify.md`](package-specs/otel-fastify.md) — added after
M2 shipped, in response to a direct request for a Fastify integration, establishing
the "framework-specific packages depend on `otel-node`, not `otel-core` directly"
pattern documented in [`docs/architecture.md`](architecture.md) §1.

**Acceptance criteria:**

- All exports in the package spec exist with matching signatures.
- `otelFastifyPlugin` verified against a real Fastify instance (via `.inject()`) with
  a real active span: route-pattern capture, error capture, and `ignoreRoutes`
  filtering all independently verified, plus the "no active span" no-op paths.
- `otelFastifyLoggerOptions()` verified to produce a working pino `mixin`.
- Depends only on `otel-node` (never `otel-core` directly, never `otel-web`) —
  matches the dependency graph in `docs/architecture.md` §1.
- `pnpm turbo run build lint typecheck test --filter=@nebula-ops/otel-fastify` all pass.
- A changeset is added for `otel-fastify`'s initial `0.1.0` release.

**Files touched:**

- `packages/otel-fastify/**`
- `docs/package-specs/otel-fastify.md` (new)
- `docs/architecture.md` §1 (dependency graph + new second-level dependency pattern note)
- `.changeset/*.md`

**Complexity:** M

**Notable finding during implementation:** a test-only gotcha, not a package-code
issue — `context.with(ctx, fn)` where `fn` is a plain synchronous arrow function
that just returns Fastify's `app.inject()` promise directly lost AsyncLocalStorage
propagation into the plugin's hooks in this specific combination, while wrapping the
same call in an explicit `async () => { return app.inject(...) }` did not. A minimal
reproduction using raw `node:async_hooks` `AsyncLocalStorage.run()` directly (no
`@opentelemetry/api`, no Fastify) showed no such difference, so this appears specific
to `ContextAPI.with()`'s or `app.inject()`'s own promise handling rather than a
general AsyncLocalStorage behavior — documented in `test/plugin.test.ts`'s comment
where the working form is used, flagged rather than fully root-caused since the fix
is empirically verified correct either way. Worth a deeper look if it recurs
elsewhere (e.g. when `otel-web` or other packages write similar `.inject()`-style
integration tests).

**Stop and check in:** confirm the "otel-node as base" dependency pattern this
establishes is the one to follow for any future framework-specific package, before
one gets added casually without the same spec-first discipline.

---

## M3 — `otel-web`

**Goal:** `otel-web` implemented to the frozen spec in
[`docs/package-specs/otel-web.md`](package-specs/otel-web.md), depending only on
`otel-core`.

**Acceptance criteria:**

- All exports in the package spec exist with matching signatures.
- `initWebTracer`/`shutdownWebTracer` verified in a browser-like test environment
  (jsdom or a real headless browser via the project's test runner) with fetch/XHR
  instrumentation producing spans.
- `reportWebVitalsAsSpans` verified against simulated `web-vitals` callbacks.
- `installConsoleBridge` verified to tag console output with active `LogContext` and
  to install/uninstall cleanly.
- No import of any `otel-node` or Node-builtin package (same dependency-graph lint
  rule as M2).
- `pnpm turbo run build lint typecheck test --filter=@nebula-ops/otel-web` all pass.
- A changeset is added for `otel-web`'s initial `0.1.0` release.

**Files touched:**

- `packages/otel-web/**`
- `.changeset/*.md`

**Complexity:** L (SDK wiring + context-manager fallback logic + web-vitals bridge +
console bridge, all needing browser-environment test coverage)

**Stop and check in:** demonstrate a minimal script/page that initializes the tracer,
makes a `fetch` call, and shows a captured span, before deciding whether to proceed to
the optional M4 packages or skip to M5 examples.

---

## M4 — Optional packages: `otel-react`, `otel-testing`

**Goal:** stretch packages implemented per their specs, only if M1–M3 are stable and
there's appetite to continue.

**Acceptance criteria (`otel-react`):**

- All exports in [`docs/package-specs/otel-react.md`](package-specs/otel-react.md)
  exist with matching signatures.
- `useSpan` verified not to leak spans across re-renders/unmounts in a React Testing
  Library test.
- `OtelErrorBoundary` verified to record a span event on a thrown error.
- Depends only on `otel-web` (never `otel-node`) — enforced by lint.
- `pnpm turbo run build lint typecheck test --filter=@nebula-ops/otel-react` all pass.
- A changeset is added for `otel-react`'s initial `0.1.0` release.

**Acceptance criteria (`otel-testing`):**

- All exports in [`docs/package-specs/otel-testing.md`](package-specs/otel-testing.md)
  exist with matching signatures.
- `expectSpan`/`expectLogRecord` verified against both a passing and a deliberately
  failing matcher (assertion actually throws with a useful message).
- Zero dependency on any other `@nebula-ops/*` package — enforced by lint.
- `pnpm turbo run build lint typecheck test --filter=@nebula-ops/otel-testing` all pass.
- A changeset is added for `otel-testing`'s initial `0.1.0` release.
- (Retroactive, optional) M1–M3 test suites migrated from raw
  `@opentelemetry/sdk-trace-base` in-memory exporters to `otel-testing`'s helpers,
  as a small follow-up changeset.

**Files touched:**

- `packages/otel-react/**`, `packages/otel-testing/**`
- `.changeset/*.md` (one per package)

**Complexity:** M each (both are narrower in scope than `otel-node`/`otel-web`)

**Stop and check in:** these are explicitly optional — confirm before starting M4 at
all whether both, one, or neither is worth building given time/priority at that point,
and check in again after each of the two sub-deliverables since they're independent.

---

## M5 — Examples and docs polish

**Goal:** prove the packages work end-to-end outside the monorepo's own unit tests,
and leave the repo in a state a new contributor or consumer can onboard from.

**Acceptance criteria:**

- `examples/node-app`: minimal Express (or plain `http`) service using `otel-node`,
  emitting real traces/logs to a local OTLP collector (e.g. via `docker-compose` with
  the OpenTelemetry Collector + a viewer like Jaeger), README with run instructions.
- `examples/web-app`: minimal Vite (or similar) app using `otel-web` (and `otel-react`
  if M4 shipped it), instrumented fetch calls visible as spans, README with run
  instructions.
- Both examples build and run via `turbo run build --filter=./examples/*` (or
  documented standalone commands if examples are intentionally excluded from the main
  task graph — decided at implementation time).
- Root `README.md` updated: what the repo is, package list with links to their specs,
  quickstart pointing at the examples.
- `docs/architecture.md` and `docs/package-specs/*.md` reviewed against what actually
  shipped; any approved deviations (see Constraints in the project brief) reconciled
  so docs match code exactly.

**Files touched:**

- `examples/node-app/**`, `examples/web-app/**`
- `README.md`
- Possibly minor edits to `docs/*` to reconcile any approved deviations

**Complexity:** M

**Stop and check in:** final review milestone — confirm the whole repo (docs + code +
examples) is coherent and ready to be considered "done" for this phase, and decide
whether any deferred item (e.g. an M4 package that was skipped) should be scheduled as
follow-up work.

---

## Cross-milestone conventions

- **Changesets are per-package, per-milestone** — not batched at the end. Each
  milestone that ships a package's first implementation (or a change to an already-
  shipped one) includes its own `pnpm changeset` addition in that milestone's PR.
- **API-surface deviations:** if implementation reveals a need to change a signature
  frozen in `docs/package-specs/*.md`, stop and flag the specific deviation with
  reasoning in the milestone's check-in rather than changing it silently — per the
  project's Phase 2 instructions.
- **Dependency-graph rule enforcement:** the "otel-node and otel-web never depend on
  each other, both depend only on otel-core" rule and "otel-core has zero
  environment-specific imports" rule are both enforced by lint/CI starting in M1, not
  left as a manual review checklist.
