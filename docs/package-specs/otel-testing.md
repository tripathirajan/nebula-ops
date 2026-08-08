# Package spec: `@nebula-ops/otel-testing` (optional / stretch)

## Purpose

`otel-testing` provides in-memory span/log exporters and assertion helpers so
consuming apps (and this monorepo's own package tests) can verify that the right
spans, attributes, and log records were produced without standing up a real OTLP
collector. It is dependency-graph-neutral: it does not depend on and is not depended
on by any other `@nebula-ops/*` package, so it can be used alongside either `otel-node`
or `otel-web` in a consuming app's test suite.

## Public exports

```ts
export function createInMemorySpanExporter(): InMemorySpanExporter; // thin wrapper around @opentelemetry/sdk-trace-base's InMemorySpanExporter
export function createInMemoryLogExporter(): InMemoryLogRecordExporter;

export interface SpanMatcher {
  name?: string | RegExp;
  attributes?: Record<string, unknown>;
  status?: { code: SpanStatusCode; message?: string };
  kind?: SpanKind;
}

export interface LogRecordMatcher {
  body?: string | RegExp;
  severityText?: string;
  attributes?: Record<string, unknown>;
}

// Throws a descriptive assertion error (framework-agnostic — works under Jest,
// Vitest, node:test) if no span in `spans` matches `matcher`.
export function expectSpan(spans: ReadableSpan[], matcher: SpanMatcher): void;
export function expectLogRecord(records: LogRecord[], matcher: LogRecordMatcher): void;

// Convenience: clears exporter buffers between tests (call in afterEach/beforeEach).
export function resetExporters(...exporters: { reset(): void }[]): void;

export const OTEL_TESTING_VERSION: string;
```

## Internal modules

| Module | Responsibility |
|---|---|
| `src/exporters/span-exporter.ts` | `createInMemorySpanExporter` wrapping `@opentelemetry/sdk-trace-base`'s `InMemorySpanExporter`. |
| `src/exporters/log-exporter.ts` | `createInMemoryLogExporter` wrapping `@opentelemetry/sdk-logs`'s in-memory equivalent (or a minimal local implementation if upstream doesn't ship one at the pinned version — confirmed during M4 implementation). |
| `src/assertions/expect-span.ts` | `expectSpan` matcher/assertion logic, framework-agnostic error formatting. |
| `src/assertions/expect-log-record.ts` | `expectLogRecord` matcher/assertion logic. |
| `src/reset.ts` | `resetExporters`. |
| `src/index.ts` | Public export barrel. |

## External dependencies

| Package | Version range | Kind |
|---|---|---|
| `@opentelemetry/api` | `^1.9.0` | `peerDependency` |
| `@opentelemetry/sdk-trace-base` | `~1.28.0` | `dependency` |
| `@opentelemetry/sdk-logs` | `~0.55.0` | `dependency` |

Deliberately **no** dependency on `@nebula-ops/otel-core`, `otel-node`, or `otel-web` —
keeping it graph-neutral is part of its purpose (a consuming app testing `otel-node`
usage and a consuming app testing `otel-web` usage both pull the same package).

## Non-goals

- Does not depend on or wrap `otel-core`/`otel-node`/`otel-web` — it operates purely at
  the `@opentelemetry/api`/SDK level, so it stays usable regardless of which
  environment package a consumer uses.
- Does not provide a full mock OTLP collector/server — in-memory exporters only. If a
  consuming app needs to test actual OTLP wire behavior, that's out of scope here.
- Not a general-purpose OpenTelemetry testing library published for the wider
  ecosystem — scoped to what this monorepo's own package tests and downstream
  `@nebula-ops/*` consumers need.
- Not built or published until M4 in [`docs/implementation-plan.md`](../implementation-plan.md);
  treated as optional scope. If dropped, package tests fall back to using upstream
  `@opentelemetry/sdk-trace-base`'s `InMemorySpanExporter` directly.
