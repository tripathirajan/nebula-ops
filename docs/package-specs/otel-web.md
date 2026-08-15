# Package spec: `@nebula-ops/otel-web`

## Purpose

`otel-web` wires up OpenTelemetry for browser frontends: it configures and starts a
`WebTracerProvider` with fetch/XHR/document-load instrumentation and an OTLP/HTTP
exporter, installs a browser-appropriate `ContextManager` so `otel-core`'s
log-context helpers work across promise/microtask boundaries in the browser, bridges
`web-vitals` metrics into spans, and provides a console binding that tags console
output with the active trace/span id. It depends only on `otel-core` and the
browser-side OpenTelemetry SDK packages — never on `otel-node`.

## Public exports

```ts
export interface NebulaWebTracerOptions extends Partial<NebulaOtelConfig> {
  instrumentations?: Instrumentation[]; // default: fetch + XHR + document-load
  exporter?: SpanExporter; // default: OTLPTraceExporter (HTTP) from config.endpoint
  propagateTraceHeaderCorsUrls?: (string | RegExp)[]; // which origins get trace headers
  contextManager?: ContextManager; // default: StackContextManager (pass ZoneContextManager explicitly to opt in — see ADR 0002 #1)
}

export function initWebTracer(options?: NebulaWebTracerOptions): WebTracerProvider;
export function shutdownWebTracer(provider: WebTracerProvider): Promise<void>;

// ---- web-vitals bridge ----
// Subscribes to web-vitals (CLS, LCP, INP, FCP, TTFB) and records each as a span
// event / standalone span on the provided tracer provider.
export function reportWebVitalsAsSpans(
  provider: WebTracerProvider,
  options?: { metrics?: WebVitalName[] },
): () => void; // returns unsubscribe function

// ---- console bridge ----
export type ConsoleLevel = 'log' | 'warn' | 'error' | 'info' | 'debug';

export interface ConsoleBridgeOptions {
  levels?: ConsoleLevel[]; // default: ['warn', 'error']
}

// Wraps console methods to attach active LogContext (trace/span id) as structured
// data and optionally forward as OTel log records. Returns an uninstall function.
export function installConsoleBridge(options?: ConsoleBridgeOptions): () => void;

// ---- Re-exports for convenience ----
export { trace, context, SpanStatusCode, SpanKind } from '@opentelemetry/api';

export const OTEL_WEB_VERSION: string;
```

## Internal modules

| Module                            | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/tracer/init.ts`              | `initWebTracer` — builds `Resource` via `otel-core#buildResource`, assembles instrumentations/exporter from options, constructs and registers `WebTracerProvider`.                                                                                                                                                                                                                                                                                                      |
| `src/tracer/shutdown.ts`          | `shutdownWebTracer`.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `src/tracer/defaults.ts`          | Default instrumentation set (`FetchInstrumentation`, `XMLHttpRequestInstrumentation`, `DocumentLoadInstrumentation`) and default OTLP/HTTP exporter factory.                                                                                                                                                                                                                                                                                                            |
| `src/context/context-manager.ts`  | Installs `StackContextManager` (from `@opentelemetry/sdk-trace-web`) by default; installs `ZoneContextManager` (from `@opentelemetry/context-zone`, an optional peer dep) only if explicitly passed via the `contextManager` option — see [ADR 0002 #1](../adr/0002-open-questions-resolutions.md#1-otel-webs-default-contextmanager-stack-not-zone) for why Stack is the default. This is the browser-specific half of the log-context story described in `otel-core`. |
| `src/vitals/report-web-vitals.ts` | `reportWebVitalsAsSpans`, wrapping the `web-vitals` package's `onCLS`/`onLCP`/etc. callbacks.                                                                                                                                                                                                                                                                                                                                                                           |
| `src/logging/console-bridge.ts`   | `installConsoleBridge`, calling `otel-core#logContextFromActiveSpan` and optionally emitting OTel log records via `@opentelemetry/sdk-logs`.                                                                                                                                                                                                                                                                                                                            |
| `src/config/from-build-env.ts`    | Helper documenting/normalizing how build-time-injected config values (e.g. via Vite `import.meta.env` or webpack `DefinePlugin`) map to the `ConfigSource` shape `otel-core#resolveConfig` expects. Does **not** read `process.env` itself.                                                                                                                                                                                                                             |
| `src/index.ts`                    | Public export barrel.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## External dependencies

| Package                                           | Version range                          | Kind                                                                                                                                                                                                                                          |
| ------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@opentelemetry/api`                              | `^1.9.0`                               | `peerDependency` (+ `devDependency`)                                                                                                                                                                                                          |
| `@nebula-ops/otel-core`                           | `workspace:*` → published semver range | `dependency`                                                                                                                                                                                                                                  |
| `@opentelemetry/sdk-trace-web`                    | `~1.28.0`                              | `dependency`                                                                                                                                                                                                                                  |
| `@opentelemetry/instrumentation-fetch`            | `~0.55.0`                              | `dependency`                                                                                                                                                                                                                                  |
| `@opentelemetry/instrumentation-xml-http-request` | `~0.55.0`                              | `dependency`                                                                                                                                                                                                                                  |
| `@opentelemetry/instrumentation-document-load`    | `~0.42.0`                              | `dependency`                                                                                                                                                                                                                                  |
| `@opentelemetry/exporter-trace-otlp-http`         | `~0.55.0`                              | `dependency`                                                                                                                                                                                                                                  |
| `@opentelemetry/context-zone`                     | `~1.28.0`                              | `peerDependency`, optional (`peerDependenciesMeta: { optional: true }`) — only needed if a consumer explicitly opts into `ZoneContextManager`; not installed by default so `zone.js` never lands in a consumer's bundle unasked (ADR 0002 #1) |
| `@opentelemetry/sdk-logs`                         | `~0.55.0`                              | `dependency` (used only by the console bridge's optional log-record emission)                                                                                                                                                                 |
| `web-vitals`                                      | `^4.2.0`                               | `dependency`                                                                                                                                                                                                                                  |

## Non-goals

- Does not implement Node-side instrumentation, NodeSDK setup, or pino/winston
  bindings — that's `otel-node`. `otel-web` never imports `otel-node` or Node
  builtins.
- Does not define the `NebulaOtelConfig` shape or config validation — consumes
  `otel-core`'s.
- Does not read `process.env` — build-time config injection is the consuming app's
  bundler's responsibility; `otel-web` only documents the expected shape.
- Does not provide React hooks/components/error boundaries — see `otel-react`, which
  depends on `otel-web` rather than the reverse.
- Does not provide in-memory exporters for testing — see `otel-testing`.
- No CAPTCHA/bot-detection interaction, no PII scrubbing by default beyond what OTel's
  instrumentations already avoid capturing (URLs/headers are captured as-is; scrubbing
  is left to consuming-app-level span processors, documented as a caller responsibility).
