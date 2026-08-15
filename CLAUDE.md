# CLAUDE.md — instructions for AI coding agents working in this repo

This file is read automatically by Claude Code (and should be read manually by any
other AI agent) before making changes in this repository. It is the authoritative
quick-reference; the full detail it summarizes lives under `docs/`. If anything here
conflicts with `docs/`, treat that as a bug in this file and fix it, don't silently
follow the stale version.

## What this repo is

`@nebula-ops/otel` — a pnpm/Turborepo monorepo of TypeScript packages wrapping
OpenTelemetry for Node backends and browser frontends, sharing a common config/
log-context core. Full context, in reading order:

1. [`docs/concepts/`](docs/concepts/) — a 9-chapter, tutorial-depth OpenTelemetry
   primer (vendor-neutral, no `@nebula-ops` code) that every design decision in this
   repo traces back to. **Read this before writing OTel-touching code, not just the
   package specs** — the specs assume this context and don't re-explain it.
2. [`docs/architecture.md`](docs/architecture.md) — package dependency graph, public
   API surface per package, config shape, peer-dependency strategy.
3. [`docs/package-specs/*.md`](docs/package-specs/) — the **frozen** public API
   surface per package (exports, signatures, internal modules, exact dependency
   versions, non-goals).
4. [`docs/adr/`](docs/adr/) — architecture decisions, including
   [0001](docs/adr/0001-monorepo-without-nx.md) (tooling choice) and
   [0002](docs/adr/0002-open-questions-resolutions.md) (resolutions to 9 open design
   questions — **check this before assuming a default behavior isn't decided yet**).
5. [`docs/implementation-plan.md`](docs/implementation-plan.md) — milestone-ordered
   task list (M0 scaffold → M1 otel-core → M2 otel-node → M3 otel-web → M4 optional
   packages → M5 examples).
6. [`docs/governance/ai-contribution-policy.md`](docs/governance/ai-contribution-policy.md) —
   the rules an AI agent (this one included) must follow when contributing here.
   **Read this in full before your first commit in this repo.**

## Non-negotiable rules

- **Never mix this repo with `nebula-lab`.** Different org, different scope
  (`nebula-lab` is UI/design-only, unrelated to this project). No shared naming, no
  cross-references.
- **Never use the unscoped name "weave"** anywhere in code, docs, or package names —
  it collides with an existing unrelated product (W&B Weave). Always `@nebula-ops/`.
- **`otel-node` and `otel-web` never depend on each other, directly or
  transitively.** Both depend only on `otel-core`. This is enforced by lint
  (`packages/*/eslint.config.js`), not just convention — if you're tempted to import
  one from the other, the fix is almost always "this belongs in `otel-core`," not "add
  the dependency."
- **`otel-core` has zero Node-only or browser-only imports.** No `fs`/`http`/
  `async_hooks`/etc., no `window`/`document`. Enforced by
  `no-restricted-imports` lint + an esbuild `platform: browser` smoke build in CI.
- **The public API surface frozen in `docs/package-specs/*.md` is the contract.** If
  implementation reveals a need to change a signature there, **stop and flag the
  deviation with reasoning** in your response — do not silently change it. Update the
  spec file in the same change if the deviation is approved.
- **No package publishes secrets/tokens.** OTLP endpoint/headers come from config
  only, sourced from the consuming app's own env/secret manager — never hardcoded,
  never logged, never committed as an example value that looks real.
- **Every changeset-worthy change ships its own changeset** (`pnpm changeset`) in the
  same PR that makes the change — not batched at the end of a milestone.

## Build/test/lint commands

```bash
pnpm install                       # from repo root
pnpm turbo run build               # build all packages (respects dependency graph)
pnpm turbo run lint                # ESLint, all packages
pnpm turbo run typecheck           # tsc --noEmit, all packages
pnpm turbo run test                # vitest, all packages
pnpm --filter @nebula-ops/otel-core build lint typecheck test   # single package
pnpm changeset                     # add a changeset for the current change
```

Every package is expected to pass `build`, `lint`, `typecheck`, and `test` before a
change is considered done — see the coverage bar below.

## Code quality bar

- **TypeScript strict mode**, everywhere. No `any` without an explicit inline
  justification comment; prefer `unknown` + narrowing.
- **100% test coverage** (branches, functions, lines, statements) is the target for
  every package's own source (`src/`), enforced via `vitest --coverage` thresholds in
  each package's `vitest.config.ts`. If a specific line is genuinely untestable
  (e.g. a defensive branch for a condition the type system already rules out),
  exclude it explicitly with a comment explaining why, rather than lowering the
  package-wide threshold.
- **Design patterns already chosen for this codebase** (match these, don't
  reinvent per package): config resolution is a pure-function **builder** (`resolveConfig`)
  over a **layered-precedence** merge (explicit > env-derived > defaults), never a
  class with mutable state; environment-specific behavior (context manager
  installation, exporter defaults) is **dependency-injected** into `otel-core`'s
  environment-agnostic functions, never branched on inside them (`if (isNode)`-style
  checks in `otel-core` are a bug, full stop); public entry points are **thin
  facade functions** (`startNodeSdk`, `initWebTracer`) assembling SDK primitives, not
  classes consumers instantiate; test doubles use **in-memory exporters**
  (`otel-testing`), never mocking the OTel API itself.
- Match existing file/module structure — see each package spec's "Internal modules"
  table before adding a new file; if what you're writing doesn't fit an existing
  module's stated responsibility, that's a signal to reconsider the module boundary,
  not to widen the existing module's responsibility silently.
- Prettier + ESLint (flat config, root-level, per-package overrides only for the
  `otel-core` import-restriction rule) format/lint everything; run `pnpm turbo run
lint` before considering a change done, don't rely on editor integration alone.

## Where things live

```
docs/            planning + reference docs (read-heavy, see above)
packages/        the actual TS packages (otel-core, otel-node, otel-web, ...)
examples/        minimal end-to-end example apps (added per-package once that
                 package ships, per docs/implementation-plan.md M5)
.changeset/       pending changesets
.github/workflows/  CI (PR checks) and release (Changesets-driven publish)
```

## When you're not sure

Check [`docs/adr/0002-open-questions-resolutions.md`](docs/adr/0002-open-questions-resolutions.md)
first — many "is this decided yet" questions are already answered there. If genuinely
undecided, follow [`docs/governance/ai-contribution-policy.md`](docs/governance/ai-contribution-policy.md)'s
guidance on making and flagging autonomous decisions rather than blocking.
