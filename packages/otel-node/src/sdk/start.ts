import { NodeSDK } from '@opentelemetry/sdk-node';
import type { ContextManager } from '@opentelemetry/api';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { MetricReader } from '@opentelemetry/sdk-metrics';
import type { LogRecordProcessor } from '@opentelemetry/sdk-logs';
import type { Instrumentation } from '@opentelemetry/instrumentation';
import { resolveConfig, buildResource, type OtelConfig } from '@nebula-ops/otel-core';
import { gatherEnvConfigSource } from '../config/from-env.js';
import { createDefaultContextManager } from '../context/context-manager.js';
import {
  createDefaultTraceExporter,
  createDefaultMetricReader,
  createDefaultLogRecordProcessor,
  createDefaultInstrumentations,
} from './defaults.js';

/**
 * The frozen public option shape from docs/package-specs/otel-node.md. Extends
 * `Partial<OtelConfig>` so a caller supplies `serviceName`/`environment`/etc.
 * directly alongside the Node-specific overrides below — `resolveConfig` (from
 * `otel-core`) is what actually reads the `OtelConfig`-shaped fields off this
 * object; the SDK-shaped fields (`instrumentations`, `traceExporter`, ...) are
 * `startNodeSdk`'s own concern.
 */
export interface NodeSdkOptions extends Partial<OtelConfig> {
  /** Default: the full `getNodeAutoInstrumentations()` preset — see ADR 0002 #4. */
  instrumentations?: Instrumentation[];
  /** Default: `OTLPTraceExporter` built from `config.endpoint`/`config.headers`. */
  traceExporter?: SpanExporter;
  /** Default: `PeriodicExportingMetricReader` + `OTLPMetricExporter`. */
  metricReader?: MetricReader;
  /** Default: `BatchLogRecordProcessor` + `OTLPLogExporter`. */
  logRecordProcessor?: LogRecordProcessor;
  /** Default: `AsyncLocalStorageContextManager` — see
   * docs/concepts/02-otel-node.md §2.3. */
  contextManager?: ContextManager;
}

/**
 * Assembles and starts a `NodeSDK` from `options` — resolving config via
 * `otel-core`'s `resolveConfig` (explicit `options` > `process.env`, gathered by
 * `gatherEnvConfigSource` > defaults), building the resource via `otel-core`'s
 * `buildResource`, and falling back to this package's own default
 * exporter/reader/processor/instrumentation factories (`./defaults.ts`) for
 * anything not explicitly overridden.
 *
 * Must be called (and `.start()` must complete) before any instrumented module
 * (`http`, `express`, `pg`, ...) is first imported anywhere in the process — see
 * docs/concepts/02-otel-node.md §2.1. In practice this means calling
 * `startNodeSdk()` from a dedicated entry file loaded via `node --require` (or
 * `--import` for ESM), not from inside the application's own first-imported module.
 */
export function startNodeSdk(options: NodeSdkOptions = {}): NodeSDK {
  const config = resolveConfig(options, gatherEnvConfigSource());
  const resource = buildResource(config);

  const sdk = new NodeSDK({
    resource,
    contextManager: options.contextManager ?? createDefaultContextManager(),
    traceExporter: options.traceExporter ?? createDefaultTraceExporter(config),
    metricReaders: [options.metricReader ?? createDefaultMetricReader(config)],
    logRecordProcessors: [options.logRecordProcessor ?? createDefaultLogRecordProcessor(config)],
    instrumentations: options.instrumentations ?? createDefaultInstrumentations(),
  });

  sdk.start();
  return sdk;
}
