---
'@nebula-ops/otel-core': minor
---

Initial implementation of `@nebula-ops/otel-core`: environment-agnostic config
resolution (`resolveConfig`/`validateConfig`) with layered precedence
(explicit overrides > env-derived source > defaults), resource building
(`buildResource`) via `OtelAttributes`' semantic-convention-backed keys, and
log-context correlation primitives (`getActiveLogContext`/`runWithLogContext`/
`bindLogContext`/`logContextFromActiveSpan`) built purely on the standard OTel
`context`/`trace` API.

Ships with zero Node-only or browser-only imports in its own source, verified by
both a per-package ESLint import restriction and an esbuild `platform: browser`
bundle smoke test in CI — `otel-node` and `otel-web` can each depend on this
package directly without either pulling in the other's environment assumptions.
