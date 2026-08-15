# Package spec: `@nebula-ops/otel-core`

## Purpose

`otel-core` is the environment-agnostic foundation shared by every other
`@nebula-ops/otel` package. It owns the `NebulaOtelConfig` shape and its resolution
rules, resource/attribute conventions layered on top of OpenTelemetry semantic
conventions, config validation, and log-context correlation primitives built on the
standard OTel `context` API. It contains no Node-only or browser-only code — it
defines the _shape_ of context propagation and configuration; `otel-node` and
`otel-web` each supply the environment-specific `ContextManager` and env-var/build-time
value gathering that plug into it. Every other package in the monorepo depends on
`otel-core`; it depends on nothing else in the monorepo.

## Public exports

```ts
// ---- Config ----
export interface NebulaOtelConfig {
  serviceName: string;
  serviceVersion?: string;
  environment?: string;
  endpoint?: string;
  headers?: Record<string, string>;
  resourceAttributes?: Record<string, string | number | boolean>;
  sampling?: { ratio?: number };
}

export interface ConfigSource {
  // Plain object of env-derived/user-supplied values; gathered by the caller
  // (otel-node reads process.env, otel-web reads build-time-injected values).
  [key: string]: unknown;
}

export function resolveConfig(
  overrides?: Partial<NebulaOtelConfig>,
  source?: ConfigSource,
): NebulaOtelConfig;

export function validateConfig(config: unknown): NebulaOtelConfig; // throws NebulaConfigError
export class NebulaConfigError extends Error {
  readonly issues: Array<{ path: string; message: string }>;
}

// ---- Resource / attributes ----
export function buildResource(config: NebulaOtelConfig): Resource; // @opentelemetry/resources Resource

export const NebulaAttributes: {
  readonly SERVICE_NAME: 'service.name';
  readonly SERVICE_VERSION: 'service.version';
  readonly DEPLOYMENT_ENVIRONMENT: 'deployment.environment';
  readonly NEBULA_PACKAGE_VERSION: 'nebula.otel.package_version';
};

// ---- Log-context correlation ----
export interface LogContext {
  traceId?: string;
  spanId?: string;
  traceFlags?: number;
  attributes?: Record<string, unknown>;
}

export function getActiveLogContext(): LogContext;
export function runWithLogContext<T>(context: LogContext, fn: () => T): T;
export function bindLogContext<Args extends unknown[], R>(
  fn: (...args: Args) => R,
): (...args: Args) => R;

// Formats the active OTel span context (if any) into a LogContext — used by
// otel-node's pino/winston bindings and otel-web's console bridge.
export function logContextFromActiveSpan(): LogContext;

// ---- Version ----
export const OTEL_CORE_VERSION: string;
```

## Internal modules

| Module                                | Responsibility                                                                                                                                                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/config/resolve.ts`               | Merge precedence: explicit overrides > `ConfigSource` values > defaults. Pure function, no I/O.                                                                                                                                    |
| `src/config/schema.ts`                | Runtime validation schema (e.g. zod) backing `validateConfig`; single source of truth for required/optional fields and types.                                                                                                      |
| `src/config/errors.ts`                | `NebulaConfigError` and issue formatting.                                                                                                                                                                                          |
| `src/resource/build-resource.ts`      | Maps `NebulaOtelConfig` → `@opentelemetry/resources` `Resource`, merging `resourceAttributes` with `NebulaAttributes`-derived values.                                                                                              |
| `src/attributes/nebula-attributes.ts` | Constants layered on `@opentelemetry/semantic-conventions`.                                                                                                                                                                        |
| `src/context/log-context.ts`          | `LogContext` type, `getActiveLogContext`/`runWithLogContext`/`bindLogContext`, implemented purely against `@opentelemetry/api`'s `context`/`trace` APIs (no `ContextManager` installation — that's the environment package's job). |
| `src/context/from-span.ts`            | `logContextFromActiveSpan` — reads `trace.getSpan(context.active())` and formats ids/flags.                                                                                                                                        |
| `src/index.ts`                        | Public export barrel — the frozen surface above, nothing else.                                                                                                                                                                     |

## External dependencies

| Package                               | Version range | Kind                                                          |
| ------------------------------------- | ------------- | ------------------------------------------------------------- |
| `@opentelemetry/api`                  | `^1.9.0`      | `peerDependency` (+ matching `devDependency` for local build) |
| `@opentelemetry/resources`            | `~1.26.0`     | `dependency`                                                  |
| `@opentelemetry/semantic-conventions` | `~1.27.0`     | `dependency`                                                  |
| `zod`                                 | `^3.23.0`     | `dependency` (config schema validation)                       |

No Node builtins, no DOM/browser globals, no bundler-specific imports.

## Non-goals

- Does not start or configure any SDK (`NodeSDK`, `WebTracerProvider`, exporters,
  instrumentations) — that's `otel-node`/`otel-web`.
- Does not read `process.env` or any browser global directly — callers gather env
  values and pass them in via `ConfigSource`.
- Does not install or manage an OTel `ContextManager` — only consumes whatever
  `ContextManager` the environment package has already installed via the standard
  `context` API.
- Does not provide logger bindings (pino/winston mixins, console bridges) — those live
  in `otel-node`/`otel-web` and call into `otel-core`'s `logContextFromActiveSpan`.
- Does not define React hooks or components (`otel-react`'s responsibility).
- Does not provide test/assertion helpers or in-memory exporters (`otel-testing`'s
  responsibility).
