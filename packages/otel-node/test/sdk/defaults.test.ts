import { describe, it, expect } from 'vitest';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import type { OtelConfig } from '@nebula-ops/otel-core';
import {
  createDefaultTraceExporter,
  createDefaultMetricReader,
  createDefaultLogRecordProcessor,
  createDefaultInstrumentations,
} from '../../src/sdk/defaults.js';

const baseConfig: OtelConfig = { serviceName: 'svc' };
const fullConfig: OtelConfig = {
  serviceName: 'svc',
  endpoint: 'https://collector.internal:4318',
  headers: { 'x-api-key': 'abc' },
};

describe('createDefaultTraceExporter', () => {
  it('returns an OTLPTraceExporter instance', () => {
    expect(createDefaultTraceExporter(baseConfig)).toBeInstanceOf(OTLPTraceExporter);
  });

  it('does not throw when endpoint/headers are both unset (falls through to exporter defaults)', () => {
    expect(() => createDefaultTraceExporter(baseConfig)).not.toThrow();
  });

  it('does not throw when endpoint and headers are both set', () => {
    expect(() => createDefaultTraceExporter(fullConfig)).not.toThrow();
  });

  it('does not throw when only endpoint is set', () => {
    expect(() =>
      createDefaultTraceExporter({
        serviceName: 'svc',
        endpoint: 'https://collector.internal:4318',
      }),
    ).not.toThrow();
  });

  it('does not throw when only headers is set', () => {
    expect(() =>
      createDefaultTraceExporter({ serviceName: 'svc', headers: { 'x-api-key': 'abc' } }),
    ).not.toThrow();
  });
});

describe('createDefaultMetricReader', () => {
  it('returns a PeriodicExportingMetricReader instance', () => {
    expect(createDefaultMetricReader(baseConfig)).toBeInstanceOf(PeriodicExportingMetricReader);
  });

  it('does not throw with a fully-specified config', () => {
    expect(() => createDefaultMetricReader(fullConfig)).not.toThrow();
  });
});

describe('createDefaultLogRecordProcessor', () => {
  it('returns a BatchLogRecordProcessor instance', () => {
    expect(createDefaultLogRecordProcessor(baseConfig)).toBeInstanceOf(BatchLogRecordProcessor);
  });

  it('does not throw with a fully-specified config', () => {
    expect(() => createDefaultLogRecordProcessor(fullConfig)).not.toThrow();
  });
});

describe('createDefaultInstrumentations', () => {
  it('returns a non-empty array of instrumentations', () => {
    const instrumentations = createDefaultInstrumentations();
    expect(Array.isArray(instrumentations)).toBe(true);
    expect(instrumentations.length).toBeGreaterThan(0);
  });
});
