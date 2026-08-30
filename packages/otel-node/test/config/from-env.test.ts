import { describe, it, expect } from 'vitest';
import { gatherEnvConfigSource } from '../../src/config/from-env.js';

describe('gatherEnvConfigSource', () => {
  it('returns an empty source when no relevant env vars are set', () => {
    expect(gatherEnvConfigSource({})).toEqual({});
  });

  it('maps OTEL_SERVICE_NAME to serviceName', () => {
    expect(gatherEnvConfigSource({ OTEL_SERVICE_NAME: 'checkout-service' })).toEqual({
      serviceName: 'checkout-service',
    });
  });

  it('maps OTEL_SERVICE_VERSION to serviceVersion, taking precedence over npm_package_version', () => {
    const source = gatherEnvConfigSource({
      OTEL_SERVICE_VERSION: '2.0.0',
      npm_package_version: '1.0.0',
    });
    expect(source.serviceVersion).toBe('2.0.0');
  });

  it('falls back to npm_package_version when OTEL_SERVICE_VERSION is unset', () => {
    const source = gatherEnvConfigSource({ npm_package_version: '1.0.0' });
    expect(source.serviceVersion).toBe('1.0.0');
  });

  it('leaves serviceVersion unset when neither OTEL_SERVICE_VERSION nor npm_package_version is present', () => {
    const source = gatherEnvConfigSource({});
    expect(source).not.toHaveProperty('serviceVersion');
  });

  it('maps OTEL_ENVIRONMENT to environment', () => {
    expect(gatherEnvConfigSource({ OTEL_ENVIRONMENT: 'production' })).toEqual({
      environment: 'production',
    });
  });

  it('maps OTEL_EXPORTER_OTLP_ENDPOINT to endpoint', () => {
    expect(
      gatherEnvConfigSource({ OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.internal:4318' }),
    ).toEqual({ endpoint: 'https://collector.internal:4318' });
  });

  it('maps OTEL_EXPORTER_OTLP_HEADERS to headers (raw string, unparsed here)', () => {
    expect(gatherEnvConfigSource({ OTEL_EXPORTER_OTLP_HEADERS: 'x-api-key=abc' })).toEqual({
      headers: 'x-api-key=abc',
    });
  });

  it('maps OTEL_RESOURCE_ATTRIBUTES to resourceAttributes (raw string, unparsed here)', () => {
    expect(gatherEnvConfigSource({ OTEL_RESOURCE_ATTRIBUTES: 'region=us-east-1' })).toEqual({
      resourceAttributes: 'region=us-east-1',
    });
  });

  it('maps OTEL_SAMPLING_RATIO to samplingRatio', () => {
    expect(gatherEnvConfigSource({ OTEL_SAMPLING_RATIO: '0.5' })).toEqual({ samplingRatio: '0.5' });
  });

  it('gathers every field at once when all env vars are set', () => {
    const source = gatherEnvConfigSource({
      OTEL_SERVICE_NAME: 'svc',
      OTEL_SERVICE_VERSION: '1.2.3',
      OTEL_ENVIRONMENT: 'staging',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.internal:4318',
      OTEL_EXPORTER_OTLP_HEADERS: 'x-api-key=abc',
      OTEL_RESOURCE_ATTRIBUTES: 'region=us-east-1',
      OTEL_SAMPLING_RATIO: '0.5',
    });
    expect(source).toEqual({
      serviceName: 'svc',
      serviceVersion: '1.2.3',
      environment: 'staging',
      endpoint: 'https://collector.internal:4318',
      headers: 'x-api-key=abc',
      resourceAttributes: 'region=us-east-1',
      samplingRatio: '0.5',
    });
  });

  it('defaults to process.env when no env object is passed', () => {
    // Just confirms the default-parameter path doesn't throw and returns an
    // object shaped like a ConfigSource — the real process.env contents in a test
    // runner are unpredictable, so we don't assert specific field values here.
    expect(typeof gatherEnvConfigSource()).toBe('object');
  });
});
