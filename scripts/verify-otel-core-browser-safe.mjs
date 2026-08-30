#!/usr/bin/env node
// Mechanical proof of the "otel-core has zero Node-only or browser-only imports"
// constraint (see CLAUDE.md, docs/architecture.md §4, and
// docs/concepts/07-generic-reusable-design.md §7.5). Bundles otel-core's entry
// point with esbuild targeting `platform: 'browser'` and no Node polyfills — if
// otel-core ever imports a Node builtin (fs, http, async_hooks, ...), esbuild fails
// to resolve it and this script exits non-zero. A lint rule catches the same class
// of mistake earlier (see packages/otel-core/eslint.config.js), but this is the
// backstop that actually proves bundler-level safety, not just static-analysis
// safety — the two checks catch overlapping but not identical mistakes.
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(__dirname, '..', 'packages', 'otel-core', 'src', 'index.ts');

if (!existsSync(entry)) {
  console.log(
    '[verify-otel-core-browser-safe] otel-core/src/index.ts does not exist yet — skipping (nothing to verify).',
  );
  process.exit(0);
}

try {
  await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    logLevel: 'silent',
    // Deliberately no `external`/polyfill config for Node builtins — if otel-core
    // needs one, esbuild will fail to resolve it, which is the point of this check.
  });
  console.log(
    '[verify-otel-core-browser-safe] OK — otel-core bundles cleanly for the browser with no Node-specific imports.',
  );
} catch (err) {
  console.error('[verify-otel-core-browser-safe] FAILED — otel-core is not environment-agnostic.');
  console.error('This means otel-core imports something Node-only (or browser-only) that cannot');
  console.error('bundle for a plain browser target. Fix the import, or move that code into');
  console.error("otel-node/otel-web instead — see CLAUDE.md's non-negotiable rules.");
  console.error();
  console.error(err.message ?? err);
  process.exit(1);
}
