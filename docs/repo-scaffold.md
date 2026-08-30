# Repo scaffold — @nebula-ops/otel

This document shows the planned repo layout and root config file contents. Nothing
here is written to disk yet — it's the Phase 1 blueprint that Phase 2 milestone M0
executes against.

## 1. Directory tree

```
nebula-ops/                          # repo root (this directory)
├── .changeset/
│   └── config.json
├── .github/
│   └── workflows/
│       ├── ci.yml                   # runs on PR
│       └── release.yml              # runs on push to main (Changesets release PR / publish)
├── docs/
│   ├── adr/
│   │   └── 0001-monorepo-without-nx.md
│   ├── architecture.md
│   ├── package-specs/
│   │   ├── otel-core.md
│   │   ├── otel-node.md
│   │   ├── otel-web.md
│   │   ├── otel-react.md
│   │   └── otel-testing.md
│   ├── repo-scaffold.md
│   └── implementation-plan.md
├── examples/
│   ├── node-app/                    # added in M2/M5
│   └── web-app/                     # added in M3/M5
├── packages/
│   ├── otel-core/
│   │   ├── src/
│   │   │   ├── config/
│   │   │   ├── resource/
│   │   │   ├── attributes/
│   │   │   ├── context/
│   │   │   └── index.ts
│   │   ├── test/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── tsup.config.ts
│   ├── otel-node/
│   │   ├── src/
│   │   │   ├── sdk/
│   │   │   ├── context/
│   │   │   ├── config/
│   │   │   ├── logging/
│   │   │   └── index.ts
│   │   ├── test/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── tsup.config.ts
│   ├── otel-web/
│   │   ├── src/
│   │   │   ├── tracer/
│   │   │   ├── context/
│   │   │   ├── vitals/
│   │   │   ├── logging/
│   │   │   ├── config/
│   │   │   └── index.ts
│   │   ├── test/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── tsup.config.ts
│   ├── otel-react/                  # M4, optional
│   │   ├── src/
│   │   ├── test/
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── otel-testing/                # M4, optional
│       ├── src/
│       ├── test/
│       ├── package.json
│       └── tsconfig.json
├── .gitignore
├── .npmrc
├── package.json                     # root
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
└── README.md
```

## 2. `pnpm-workspace.yaml`

```yaml
packages:
  - 'packages/*'
  - 'examples/*'
```

## 3. `turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "lint": {
      "dependsOn": [],
      "outputs": []
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "clean": {
      "cache": false,
      "outputs": []
    }
  }
}
```

Task graph notes:

- `build` depends on `^build` — a package's own build waits for all of its workspace
  dependencies to build first (e.g. `otel-node`'s build waits on `otel-core`'s build).
- `typecheck` also depends on `^build` because `otel-node`/`otel-web` typecheck against
  `otel-core`'s built `.d.ts` output (project references could be used instead; decided
  at M0 implementation time — see [`docs/implementation-plan.md`](implementation-plan.md)).
- `test` depends on `^build` for the same reason (packages import their workspace deps'
  built output, matching how consumers will actually use them).
- `lint` has no cross-package dependency — it only inspects a package's own source, so
  it can run fully in parallel across the workspace.
- `outputs` declared per task is what Turborepo hashes/caches; `dist/**` and
  `coverage/**` are cached, `lint`/`clean` are not (lint has no build artifact worth
  caching beyond its own pass/fail, `clean` must always actually run).

## 4. Root `package.json`

```json
{
  "name": "nebula-ops-otel",
  "private": true,
  "version": "0.0.0",
  "packageManager": "pnpm@9.7.0",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "turbo run build",
    "typecheck": "turbo run typecheck",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "clean": "turbo run clean",
    "changeset": "changeset",
    "changeset:version": "changeset version",
    "changeset:publish": "turbo run build --filter='./packages/*' && changeset publish"
  },
  "devDependencies": {
    "@changesets/cli": "^2.27.0",
    "turbo": "^2.0.0",
    "typescript": "^5.5.0",
    "eslint": "^9.9.0",
    "prettier": "^3.3.0"
  }
}
```

Individual `packages/*/package.json` files (not shown here — frozen at M0/M1
implementation time per package) will each declare `"name": "@nebula-ops/<pkg>"`, the
`peerDependencies`/`dependencies` listed in the relevant
[`docs/package-specs/`](package-specs/) file, and a `dist`-based `exports` map (ESM +
CJS via `tsup`, `.d.ts` types) — with `otel-core`'s `exports` field carrying no
`browser`/`node` conditional entries, per the environment-agnostic constraint in
[`docs/architecture.md`](architecture.md).

## 5. Build/test/lint pipeline

| Task        | Command               | What it does                                                                                                                                  |
| ----------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `build`     | `turbo run build`     | Each package's `tsup` build (ESM + CJS + `.d.ts`), ordered by `^build`.                                                                       |
| `typecheck` | `turbo run typecheck` | `tsc --noEmit` per package against `tsconfig.base.json`, strict mode.                                                                         |
| `lint`      | `turbo run lint`      | ESLint per package, including the `otel-core` environment-agnostic import-restriction rule (§4 of [`docs/architecture.md`](architecture.md)). |
| `test`      | `turbo run test`      | Vitest per package (unit tests; `otel-testing`-backed assertions once M4 lands).                                                              |
| `clean`     | `turbo run clean`     | Removes `dist/`, `coverage/`, and turbo cache markers per package.                                                                            |

Every task is cached by Turborepo based on file-content hashes of each package's
inputs, so an unrelated `otel-web` change doesn't invalidate `otel-core`'s cached
`build`/`test` results.

## 6. CI outline

**On pull request** (`.github/workflows/ci.yml`):

1. Checkout, setup pnpm + Node 20, `pnpm install --frozen-lockfile`.
2. `pnpm turbo run lint typecheck test build` (single Turborepo invocation covering
   all four tasks, leveraging its cache).
3. `otel-core` browser-safety smoke check: esbuild bundle of `packages/otel-core` with
   `platform: browser`, no polyfills, must succeed (§4 of
   [`docs/architecture.md`](architecture.md)).
4. Changesets check (`changeset status` / the official `changesets/action` in "check
   only" or a plain status-check mode) — fails the PR if a package under
   `packages/*` changed without an accompanying changeset file, unless the PR is
   labeled `no-changeset` (docs-only PRs, CI config, etc.).
5. (Once `examples/*` exist, M5 onward) run each example's own build/typecheck as an
   extra safety net that the packages work end-to-end, not just in unit tests.

**On push to the default branch** (`.github/workflows/release.yml`):

1. Checkout, setup pnpm + Node 20, `pnpm install --frozen-lockfile`.
2. Run the `changesets/action` GitHub Action:
   - If there are pending changesets, it opens/updates a "Version Packages" release PR
     (running `changeset version`, bumping affected package versions, updating
     CHANGELOGs, committing).
   - If that release PR is merged (i.e. this run _is_ the merge of a version-bump
     commit with no new pending changesets), it runs `pnpm build` then
     `changeset publish`, which publishes any packages whose `package.json` version
     doesn't yet exist on the npm registry, tags the commit, and pushes git tags.
3. Publishing uses an `NPM_TOKEN` repository secret consumed only by the release
   workflow — never checked into config, never referenced by package code (consistent
   with the project constraint that no package publishes secrets/tokens itself).

This gives the standard Changesets flow: every merged feature PR with a changeset
accumulates into an open release PR; merging the release PR is the actual publish
trigger, keeping "what will be published, at what versions, with what changelog"
visible and reviewable before it happens.
