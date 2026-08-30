---
name: new-otel-package
description: Scaffold a new package under packages/ in this monorepo following the repo's established conventions (package.json exports field, tsconfig, tsup build config, vitest config with 100% coverage thresholds, ESLint config). Use when adding a package this repo's docs/implementation-plan.md calls for (otel-core, otel-node, otel-web, otel-react, otel-testing) or a genuinely new one approved by the maintainer — not for editing an existing package's files.
---

# Scaffold a new `@nebula-ops/otel` package

Before running this: confirm `docs/package-specs/<package-name>.md` already exists
and is the frozen spec for what you're about to scaffold. If it doesn't exist yet,
stop — write the spec first (see `docs/package-specs/` for the format every other
package follows: Purpose, Public exports, Internal modules, External dependencies,
Non-goals) and get it reviewed before scaffolding code against it. Scaffolding ahead
of a spec is how the frozen-API-surface discipline this repo relies on breaks down.

## Steps

1. **Confirm the package name and read its spec fully**
   (`docs/package-specs/<name>.md`) — note every public export, every internal
   module listed, and every external dependency with its exact version.

2. **Create the directory structure** matching
   [`docs/repo-scaffold.md`](../../../docs/repo-scaffold.md) §1:

   ```
   packages/<name>/
     src/
       index.ts          # public export barrel — matches the spec's "Public exports" exactly
       <module dirs per the spec's "Internal modules" table>/
     test/
     package.json
     tsconfig.json
     tsup.config.ts
     vitest.config.ts
   ```

3. **`package.json`** — name it `@nebula-ops/<name>`, set `"version": "0.0.0"`
   (Changesets manages real versions from here), populate `dependencies`/
   `peerDependencies`/`peerDependenciesMeta` exactly from the spec's "External
   dependencies" table (exact versions, correct dependency kind — peer vs regular,
   per [`docs/architecture.md`](../../../docs/architecture.md) §5's peer-dependency
   strategy). Set `exports` to a dual ESM/CJS map pointing at `dist/`. If this is
   `otel-core`, the `exports` field must have **no** `browser`/`node` conditional
   entries — a single entry point, since that's the mechanical proof of the
   environment-agnostic constraint (see `CLAUDE.md`).

4. **`tsconfig.json`** — extends the root `tsconfig.base.json` (strict mode
   inherited, don't relax it per-package).

5. **`tsup.config.ts`** — dual ESM+CJS output with `.d.ts` generation, matching every
   other package's build config (copy an existing package's `tsup.config.ts` rather
   than writing one from scratch, to keep build output shape consistent across the
   monorepo).

6. **`vitest.config.ts`** — set coverage thresholds to 100% for branches, functions,
   lines, and statements (per `CLAUDE.md`'s coverage bar):

   ```ts
   import { defineConfig } from 'vitest/config';
   export default defineConfig({
     test: {
       coverage: {
         provider: 'v8',
         thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
       },
     },
   });
   ```

   If `otel-core`, additionally verify no browser/Node-specific test setup leaks in
   here — tests for `otel-core` should run under plain Node with no jsdom/browser
   environment, since the package itself must not assume one.

7. **`src/index.ts`** — write the export barrel to match the spec's "Public exports"
   section signature-for-signature. Implementation of each module goes in the
   internal-module files the spec's table names — don't put implementation directly
   in `index.ts` beyond re-exports.

8. **If this package is `otel-core`**, also add (or confirm present)
   `eslint.config.js` overrides blocking Node builtins/browser globals in its `src/`
   — see `CLAUDE.md`'s non-negotiable rules and
   [`docs/concepts/07-generic-reusable-design.md`](../../../docs/concepts/07-generic-reusable-design.md)
   §7.5 for the exact lint rule shape.

9. **Verify the scaffold builds clean before writing real logic**: run
   `pnpm turbo run build lint typecheck test --filter=@nebula-ops/<name>` — an empty package
   with just the barrel file and no real exports yet should still pass all four
   (test can be a single trivial passing test as a placeholder, coverage thresholds
   apply once real code exists).

10. **Add the package to the root workspace** if `pnpm-workspace.yaml`'s glob
    (`packages/*`) doesn't already cover it (it should, if scaffolded under
    `packages/`) — run `pnpm install` from the repo root afterward regardless, to
    pick up the new package in the lockfile.

## After scaffolding

Hand off to actual implementation against the spec's internal-modules table.
Coverage thresholds mean tests should generally be written alongside each module,
not bolted on at the end once everything's implemented — that's also how "100%
coverage" stays achievable without a scramble at the end to cover every branch a
fully-built module accumulated.
