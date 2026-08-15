# Package spec: `@nebula-ops/otel-node`

## Purpose

`otel-node` wires up OpenTelemetry for Node.js backend services: it configures and
starts a `NodeSDK` with sensible defaults (auto-instrumentations, OTLP exporters for
traces/metrics/logs), installs an `AsyncLocalStorage`-based `ContextManager` so
`otel-core`'s log-context helpers work across async boundaries, and provides
pino/winston bindings that pull the active trace/span id into every log line via
`otel-core`. It depends only on `otel-core` and the Node-side OpenTelemetry SDK
packages — never on `otel-web`.

## Public exports

```ts
export interface NebulaNodeSdkOptions extends Partial<NebulaOtelConfig> {
  instrumentations?: Instrumentation[]; // default: getNodeAutoInstrumentations() preset
  traceExporter?: SpanExporter; // default: OTLPTraceExporter from config.endpoint
  metricReader?: MetricReader; // default: PeriodicExportingMetricReader + OTLPMetricExporter
  logRecordProcessor?: LogRecordProcessor; // default: BatchLogRecordProcessor + OTLPLogExporter
  contextManager?: ContextManager; // default: AsyncLocalStorageContextManager
}

export function startNodeSdk(options?: NebulaNodeSdkOptions): NodeSDK;
export function shutdownNodeSdk(sdk: NodeSDK): Promise<void>;

// Registers process signal handlers (SIGTERM/SIGINT) that call shutdownNodeSdk.
// Returns an unregister function.
export function registerShutdownHandlers(sdk: NodeSDK): () => void;

// ---- Logger bindings ----
// pino: pass the returned function as the `mixin` option to pino().
export function createPinoMixin(): () => Record<string, unknown>;

// winston: pass the returned Format to winston.format.combine(...).
export function createWinstonFormat(): winston.Logform.Format;

// ---- Re-exports for convenience (from @opentelemetry/api) ----
export { trace, context, metrics, SpanStatusCode, SpanKind } from '@opentelemetry/api';

export const OTEL_NODE_VERSION: string;
```

## Internal modules

| Module                           | Responsibility                                                                                                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/sdk/start.ts`               | `startNodeSdk` — builds `Resource` via `otel-core#buildResource`, assembles exporters/processors from options + resolved config, constructs and starts `NodeSDK`.                                      |
| `src/sdk/shutdown.ts`            | `shutdownNodeSdk`, `registerShutdownHandlers`.                                                                                                                                                         |
| `src/sdk/defaults.ts`            | Default exporter/processor/instrumentation factory functions, reading `NebulaOtelConfig.endpoint`/`headers`.                                                                                           |
| `src/context/context-manager.ts` | Installs `AsyncLocalStorageContextManager` from `@opentelemetry/context-async-hooks` against the global OTel `context` API — the Node-specific half of the log-context story described in `otel-core`. |
| `src/config/from-env.ts`         | Gathers `process.env` values into the `ConfigSource` shape `otel-core#resolveConfig` expects (`OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, etc.).                                               |
| `src/logging/pino-mixin.ts`      | `createPinoMixin`, calling `otel-core#logContextFromActiveSpan`.                                                                                                                                       |
| `src/logging/winston-format.ts`  | `createWinstonFormat`, same underlying context source.                                                                                                                                                 |
| `src/index.ts`                   | Public export barrel.                                                                                                                                                                                  |

## External dependencies

| Package                                     | Version range                          | Kind                                                                      |
| ------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------- |
| `@opentelemetry/api`                        | `^1.9.0`                               | `peerDependency` (+ `devDependency`)                                      |
| `@nebula-ops/otel-core`                     | `workspace:*` → published semver range | `dependency`                                                              |
| `@opentelemetry/sdk-node`                   | `~0.55.0`                              | `dependency`                                                              |
| `@opentelemetry/auto-instrumentations-node` | `~0.50.0`                              | `dependency`                                                              |
| `@opentelemetry/exporter-trace-otlp-http`   | `~0.55.0`                              | `dependency`                                                              |
| `@opentelemetry/exporter-metrics-otlp-http` | `~0.55.0`                              | `dependency`                                                              |
| `@opentelemetry/exporter-logs-otlp-http`    | `~0.55.0`                              | `dependency`                                                              |
| `@opentelemetry/sdk-metrics`                | `~1.28.0`                              | `dependency`                                                              |
| `@opentelemetry/sdk-logs`                   | `~0.55.0`                              | `dependency`                                                              |
| `@opentelemetry/context-async-hooks`        | `~1.28.0`                              | `dependency`                                                              |
| `pino`                                      | `^9.0.0`                               | `peerDependency`, optional (only needed if `createPinoMixin` is used)     |
| `winston`                                   | `^3.13.0`                              | `peerDependency`, optional (only needed if `createWinstonFormat` is used) |

pino/winston are marked `peerDependenciesMeta: { optional: true }` — a consumer using
only one of the two logger bindings shouldn't be forced to install the other.

## Non-goals

- Does not implement browser tracing, fetch/XHR instrumentation, or web-vitals —
  that's `otel-web`. `otel-node` never imports `otel-web` or browser-only packages.
- Does not define the `NebulaOtelConfig` shape or config validation — consumes
  `otel-core`'s.
- Does not provide React integration.
- Does not provide in-memory exporters for testing — see `otel-testing`. (Consuming
  apps' own tests should use `otel-testing`, not reach into `otel-node` internals.)
- Does not manage secrets — OTLP `headers`/`endpoint` are passed through from config
  only, never hardcoded or logged.
- Does not expose a config passthrough for `enhancedDatabaseReporting` or verbatim
  Redis command-argument capture — both are real PII/secret exposure risks
  ([concepts ch. 2 §2.6](../concepts/02-otel-node.md#26-outbound-calls--httpdbredis-client-spans)).
  A consumer that genuinely needs this constructs its own instrumentation instance
  and passes it via the `instrumentations` override; it is never one config flag away
  from being enabled. See [ADR 0002 #5](../adr/0002-open-questions-resolutions.md#5-enhanceddatabasereporting--redis-argument-capture-not-exposed-as-a-passthrough).
- Does not bridge trace context across Redis pub/sub (`PUBLISH`/`SUBSCRIBE`) — no
  standard upstream instrumentation does this either
  ([concepts ch. 2 §2.6](../concepts/02-otel-node.md#26-outbound-calls--httpdbredis-client-spans)).
  Out of scope per [ADR 0002 #6](../adr/0002-open-questions-resolutions.md#6-redis-pubsub-trace-propagation-explicit-non-goal).
- Does not ship message-queue-specific (Kafka/AMQP) helpers or wrap the
  per-message `context.with()` pattern — documented in
  [concepts ch. 2 §2.7](../concepts/02-otel-node.md#27-inboundoutbound-for-message-queues--the-pattern-that-breaks-naive-assumptions)
  for consuming services to apply themselves. See
  [ADR 0002 #7](../adr/0002-open-questions-resolutions.md#7-message-queue-consumer-context-scoping-documented-pattern-no-dedicated-code).
- Does not commit to verified ESM support for M1–M3 — CJS is the tested target;
  ESM output ships (dual build) but the loader-hook requirement for
  auto-instrumentation under ESM ([concepts ch. 2 §2.9](../concepts/02-otel-node.md#29-esm--a-genuinely-different-mechanism-not-just-a-syntax-change))
  is not exercised in CI at this stage. See
  [ADR 0002 #8](../adr/0002-open-questions-resolutions.md#8-esm-support-cjs-is-the-verified-target-esm-is-best-effortundocumented-for-m1m3).
