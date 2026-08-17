import type { NebulaOtelConfig } from '@nebula-ops/otel-core';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import type { Instrumentation } from '@opentelemetry/instrumentation';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { PeriodicExportingMetricReader, type IMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor, type LogRecordProcessor } from '@opentelemetry/sdk-logs';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';

/** Shared by every default exporter factory below — builds the `{ url, headers }`
 * OTLP exporter options from config, omitting keys entirely (not
 * `undefined`-valued) when unset, matching the repo's `exactOptionalPropertyTypes`
 * discipline (see @nebula-ops/otel-core's src/internal/object-utils.ts doc comment
 * for the same rule). Falls through to each OTLP exporter's own built-in defaults
 * (env vars, then `http://localhost:4318/...`) when `config.endpoint` is unset —
 * standard OTel SDK behavior, not something otel-node overrides. */
function otlpExporterOptions(config: NebulaOtelConfig) {
  return {
    ...(config.endpoint !== undefined ? { url: config.endpoint } : {}),
    ...(config.headers !== undefined ? { headers: config.headers } : {}),
  };
}

/** Default trace exporter: OTLP/HTTP — docs/package-specs/otel-node.md's frozen
 * default for `NebulaNodeSdkOptions.traceExporter`. */
export function createDefaultTraceExporter(config: NebulaOtelConfig): SpanExporter {
  return new OTLPTraceExporter(otlpExporterOptions(config));
}

/** Default metric reader: `PeriodicExportingMetricReader` + OTLP/HTTP exporter —
 * the frozen default for `NebulaNodeSdkOptions.metricReader`. */
export function createDefaultMetricReader(config: NebulaOtelConfig): IMetricReader {
  return new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(otlpExporterOptions(config)),
  });
}

/** Default log record processor: `BatchLogRecordProcessor` + OTLP/HTTP exporter —
 * the frozen default for `NebulaNodeSdkOptions.logRecordProcessor`. This is used
 * only for Pattern A's optional log-record emission path / otel-testing's in-memory
 * exporter — ADR 0002 #3 confirms Pattern B (Logs Bridge) is out of scope for
 * M1-M3, so nothing in `startNodeSdk` wires application log calls into this
 * processor automatically. */
export function createDefaultLogRecordProcessor(config: NebulaOtelConfig): LogRecordProcessor {
  return new BatchLogRecordProcessor(new OTLPLogExporter(otlpExporterOptions(config)));
}

/** Default instrumentation set: the full `auto-instrumentations-node` meta-package,
 * unmodified — per ADR 0002 #4, matching upstream's own default rather than a
 * curated subset. Callers wanting to trim it use the documented per-instrumentation
 * `{ enabled: false }` pattern (docs/concepts/02-otel-node.md §2.2) or override
 * `NebulaNodeSdkOptions.instrumentations` entirely. */
export function createDefaultInstrumentations(): Instrumentation[] {
  return getNodeAutoInstrumentations();
}
