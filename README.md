# @nebula-ops/otel

A pnpm/Turborepo monorepo of TypeScript packages wrapping OpenTelemetry for Node
backends and browser frontends, sharing a common config and log-context core.

**Start here if you're new to this repo:**

- [`CLAUDE.md`](CLAUDE.md) — instructions for AI coding agents (also a good
  human-readable orientation to the repo's rules and conventions).
- [`docs/concepts/`](docs/concepts/) — a 9-chapter, tutorial-depth OpenTelemetry
  primer everything else in this repo is built on top of.
- [`docs/architecture.md`](docs/architecture.md) — package dependency graph, public
  API surface per package, config shape.
- [`docs/package-specs/`](docs/package-specs/) — the frozen public API per package.
- [`docs/implementation-plan.md`](docs/implementation-plan.md) — milestone plan.
- [`docs/governance/ai-contribution-policy.md`](docs/governance/ai-contribution-policy.md) —
  rules for AI-assisted contributions to this repo.

## Packages

| Package                                       | Status       | Purpose                                                                                                          |
| --------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------- |
| [`@nebula-ops/otel-core`](packages/otel-core) | done (M1)    | Config schema, resource/attribute conventions, environment-agnostic log-context propagation. 100% test coverage. |
| [`@nebula-ops/otel-node`](packages/otel-node) | done (M2)    | NodeSDK setup, auto-instrumentations, OTLP exporters, pino/winston bindings. 100% test coverage.                 |
| [`@nebula-ops/otel-web`](packages/otel-web)   | planned      | WebTracerProvider, fetch/XHR instrumentation, web-vitals bridge.                                                 |
| `@nebula-ops/otel-react`                      | stretch (M4) | Route-change spans, error boundary → span events, `useSpan`.                                                     |
| `@nebula-ops/otel-testing`                    | stretch (M4) | In-memory exporters, span/log assertion helpers.                                                                 |

`otel-node` and `otel-web` never depend on each other — both depend only on
`otel-core`. See [`docs/architecture.md`](docs/architecture.md) for why.

## Examples

- [`examples/node-app`](examples/node-app) — a minimal Express service showing
  `otel-core`/`otel-node` end-to-end: auto-instrumentation, a manual span, error
  recording, and trace-correlated pino logs. `pnpm --filter node-app dev` and go.

## Development

```bash
pnpm install
pnpm turbo run build lint typecheck test
```

See [`CLAUDE.md`](CLAUDE.md) for the full command reference and code quality bar
(TypeScript strict mode, 100% test coverage target, ESLint/Prettier).

## Versioning and releases

Changesets, independent per-package versioning — see
[ADR 0001](docs/adr/0001-monorepo-without-nx.md). Add a changeset
(`pnpm changeset`) alongside any change that affects a published package's behavior.
