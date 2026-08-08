# ADR 0001: Monorepo tooling — pnpm workspaces + Turborepo + Changesets (no Nx)

## Status

Accepted — 2026-08-08

## Context

`@nebula-ops/otel` ships five related TypeScript packages (`otel-core`, `otel-node`,
`otel-web`, and the stretch packages `otel-react`, `otel-testing`) that share a strict
internal dependency graph (`otel-core` is the only common dependency; `otel-node` and
`otel-web` must never depend on each other) and that need to be versioned and published
independently to npm under the `@nebula-ops/` scope.

We need to decide:

1. **Repo topology** — one repo with multiple packages, or one repo per package.
2. **Workspace/package manager** — how packages resolve each other locally and how
   scripts run across packages.
3. **Task orchestration** — how `build`/`test`/`lint` are sequenced across packages
   respecting the dependency graph, with caching so CI and local dev aren't
   recompiling untouched packages.
4. **Versioning/release** — how package versions and CHANGELOGs are produced and
   how publishing to npm is triggered.

This is a small-to-medium package count (5 packages, no plans for dozens), maintained
by a small team, with a simple, mostly-linear dependency graph (no deep cross-package
build graphs, no generated code, no polyglot targets). That shape matters a lot for
which tools are worth their overhead.

## Decision

- **Repo topology:** single monorepo (`nebula-ops/otel`), not separate repos per
  package.
- **Workspace/package manager:** **pnpm workspaces**.
- **Task orchestration:** **Turborepo**, not Nx, not plain hand-rolled topological
  npm scripts.
- **Versioning:** **Changesets**, with independent (not lockstep) versioning per
  package.

## Options Considered

### Repo topology: monorepo vs. separate repos per package

| Option | Notes |
|---|---|
| **Monorepo (chosen)** | One source of truth for the shared `otel-core` config schema/API surface; atomic cross-package PRs when `otel-core`'s public API changes and `otel-node`/`otel-web` need to adapt in lockstep; single CI/lint/TS-config setup. |
| Separate repos per package | Would require publishing `otel-core` and consuming it via a registry dependency even during same-day development across packages, adding release-and-bump friction for every coordinated change. Better isolation and independent CI, but not worth it at this package count and with this much inter-package coupling. |

**Chosen: monorepo.** The packages are tightly coupled by design (shared config
schema, frozen API surface referenced from multiple package specs) — a monorepo lets
a single PR touch `otel-core` and its consumers together and lets CI verify the whole
graph builds before merge.

### Workspace/package manager: pnpm workspaces vs Nx vs Lerna vs separate repos

| Option | Notes |
|---|---|
| **pnpm workspaces (chosen)** | Native workspace protocol (`workspace:*`), strict node_modules (catches phantom/undeclared dependencies — important for enforcing "otel-core has zero Node/browser-only imports"), fast installs, content-addressable store. No extra tool needed just to link local packages. |
| Nx | Full-featured monorepo tool with its own task graph, generators, and plugin ecosystem. Powerful, but brings a generator/plugin mental model, an `nx.json` project-graph layer, and a steeper onboarding cost that isn't justified for 5 packages with a simple, mostly-linear dependency chain. Explicitly excluded by project requirements. |
| Lerna | Historically the standard for JS monorepo versioning + publishing. Now largely superseded — modern Lerna itself delegates task running to Nx under the hood, and Changesets covers the versioning/changelog job we actually need. Adds a second tool doing what Changesets + pnpm already do. |
| Separate repos (no workspace tool) | See topology discussion above — rejected for tightness of coupling. |

**Chosen: pnpm workspaces.** It's the minimal tool that solves local linking,
dependency hygiene, and install performance, without imposing a generator/plugin
framework the project doesn't need.

### Task orchestration: Turborepo vs plain topological npm scripts

| Option | Notes |
|---|---|
| **Turborepo (chosen)** | Declarative task graph (`turbo.json`) with automatic topological ordering (`^build` = "build my dependencies first"), local + remote caching so unchanged packages skip re-running `build`/`lint`/`test`, and simple config surface (single JSON file, no plugin system). Pairs naturally with pnpm workspaces. |
| Plain topological scripts (e.g. hand-written `pnpm -r --filter` scripts, or `wireit`) | Avoids adding a dependency, but we'd hand-roll caching and dependency-aware ordering ourselves, or go without caching entirely — meaningful once CI runs `build`+`lint`+`test` on every PR across 5 packages. Not worth reinventing. |
| Nx task graph | Same capability as Turborepo (topological task graph + caching) but bundled with the rest of Nx's opinionated framework, which we've already excluded. |

**Chosen: Turborepo.** It gives us caching and correct dependency ordering
(`build` depends on `^build`, etc.) with a small, focused config file and no
generator/plugin system to learn.

### Versioning/release: Changesets vs lockstep versioning

| Option | Notes |
|---|---|
| **Changesets, independent versioning (chosen)** | Each package gets its own semver line and CHANGELOG, bumped only when it actually changes. Contributors add a changeset (`pnpm changeset`) alongside their PR describing the change and bump type; a release PR batches and publishes. Matches the fact that `otel-web`/`otel-react` will likely iterate faster than the more stable `otel-core`. |
| Lockstep versioning (all packages share one version number) | Simpler mental model ("everything is v1.4.0"), but forces a version (and changelog noise) bump on `otel-web` even when only `otel-node` changed, and misrepresents compatibility — consumers would reasonably assume a lockstep bump means something changed everywhere. |
| Manual versioning / hand-written CHANGELOGs | No tooling dependency, but error-prone (forgotten bumps, inconsistent changelog format) and doesn't scale as more contributors touch the repo. |

**Chosen: Changesets with independent versioning.** It keeps semver meaningful per
package, generates CHANGELOGs automatically from PR-time changeset files, and is the
de facto standard for pnpm-workspace monorepos publishing multiple public packages.

## Trade-offs

- **pnpm workspaces vs Nx:** we give up Nx's generators, affected-graph visualization,
  and larger plugin ecosystem. Acceptable — the package count and dependency graph are
  small enough that these wouldn't pay for their setup/learning cost.
- **Turborepo vs Nx:** Turborepo's task graph is coarser (task-level, not as deep a
  project-graph model as Nx). Acceptable given our dependency graph is shallow
  (`otel-core` → `{otel-node, otel-web}` → `{otel-react}`, plus `otel-testing`
  standalone).
- **Independent versioning vs lockstep:** consumers must track compatible version
  ranges across packages themselves (e.g. "otel-node 1.x requires otel-core ^1.2").
  Mitigated by pinning internal cross-package deps with `workspace:*` at dev time and
  Changesets' `workspace:*` → semver-range replacement at publish time, plus explicit
  peer-dependency ranges documented in [`docs/architecture.md`](../architecture.md).
- **No Nx means no built-in "affected" detection for CI beyond what Turborepo's cache
  provides.** Turborepo's remote/local caching covers the common case (skip unchanged
  packages); if we later need finer-grained "which packages are affected by this
  diff" logic, we can add `turbo run build --filter=...[origin/main]` filtering,
  which covers the same need without adopting Nx.

## Consequences

- All packages live in `nebula-ops/otel` under `packages/*`, installed and linked via
  `pnpm-workspace.yaml`.
- `turbo.json` defines the task graph (`build`, `lint`, `test`, `typecheck`) with
  `^build` dependency ordering; see [`docs/repo-scaffold.md`](../repo-scaffold.md).
- Every PR that changes a published package's behavior must include a changeset
  (`pnpm changeset`); CI can enforce this via a Changesets status check.
- Publishing to npm happens from a release PR (opened/updated by the Changesets GitHub
  action) merging to the default branch — see [`docs/repo-scaffold.md`](../repo-scaffold.md)
  CI outline for the PR-vs-release split.
- If the project later grows well beyond 5 packages or needs generators/deeper
  project-graph tooling, revisit Nx adoption as a follow-up ADR rather than retrofitting
  it silently.
