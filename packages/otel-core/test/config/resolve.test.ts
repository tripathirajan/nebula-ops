import { describe, it, expect } from 'vitest';
import { resolveConfig } from '../../src/config/resolve.js';
import { NebulaConfigError } from '../../src/config/errors.js';

describe('resolveConfig', () => {
  it('throws NebulaConfigError when serviceName is absent from both overrides and source', () => {
    expect(() => resolveConfig()).toThrow(NebulaConfigError);
    expect(() => resolveConfig({}, {})).toThrow(NebulaConfigError);
  });

  it('resolves serviceName from source when overrides omit it', () => {
    const config = resolveConfig({}, { serviceName: 'from-source' });
    expect(config.serviceName).toBe('from-source');
  });

  it('prefers overrides.serviceName over source.serviceName', () => {
    const config = resolveConfig({ serviceName: 'from-override' }, { serviceName: 'from-source' });
    expect(config.serviceName).toBe('from-override');
  });

  it('defaults sampling.ratio to 1.0 when neither overrides nor source specify one', () => {
    const config = resolveConfig({ serviceName: 'svc' });
    expect(config.sampling).toEqual({ ratio: 1.0 });
  });

  it('reads sampling ratio from source.samplingRatio as a numeric string', () => {
    const config = resolveConfig({}, { serviceName: 'svc', samplingRatio: '0.2' });
    expect(config.sampling).toEqual({ ratio: 0.2 });
  });

  it('reads sampling ratio from source.samplingRatio as a number', () => {
    const config = resolveConfig({}, { serviceName: 'svc', samplingRatio: 0.3 });
    expect(config.sampling).toEqual({ ratio: 0.3 });
  });

  it('prefers overrides.sampling.ratio over source.samplingRatio', () => {
    const config = resolveConfig(
      { serviceName: 'svc', sampling: { ratio: 0.9 } },
      { samplingRatio: '0.1' },
    );
    expect(config.sampling).toEqual({ ratio: 0.9 });
  });

  it('falls back to the default ratio when source.samplingRatio is not a finite number', () => {
    const config = resolveConfig({}, { serviceName: 'svc', samplingRatio: 'not-a-number' });
    expect(config.sampling).toEqual({ ratio: 1.0 });
  });

  it('falls back to the default ratio when source.samplingRatio is NaN/Infinity', () => {
    expect(resolveConfig({}, { serviceName: 'svc', samplingRatio: Number.NaN }).sampling).toEqual({
      ratio: 1.0,
    });
    expect(
      resolveConfig({}, { serviceName: 'svc', samplingRatio: Number.POSITIVE_INFINITY }).sampling,
    ).toEqual({ ratio: 1.0 });
  });

  it('falls back to the default ratio when source.samplingRatio is an unsupported type', () => {
    const config = resolveConfig({}, { serviceName: 'svc', samplingRatio: { not: 'a number' } });
    expect(config.sampling).toEqual({ ratio: 1.0 });
  });

  it('ignores an empty-string samplingRatio and falls back to default', () => {
    const config = resolveConfig({}, { serviceName: 'svc', samplingRatio: '' });
    expect(config.sampling).toEqual({ ratio: 1.0 });
  });

  it('resolves optional string fields (serviceVersion/environment/endpoint) from source', () => {
    const config = resolveConfig(
      {},
      {
        serviceName: 'svc',
        serviceVersion: '2.0.0',
        environment: 'staging',
        endpoint: 'https://collector.internal:4318',
      },
    );
    expect(config.serviceVersion).toBe('2.0.0');
    expect(config.environment).toBe('staging');
    expect(config.endpoint).toBe('https://collector.internal:4318');
  });

  it('prefers overrides over source for optional string fields', () => {
    const config = resolveConfig(
      { serviceVersion: 'override-version' },
      { serviceName: 'svc', serviceVersion: 'source-version' },
    );
    expect(config.serviceVersion).toBe('override-version');
  });

  it('ignores non-string / empty-string values for optional string source fields', () => {
    const config = resolveConfig(
      {},
      { serviceName: 'svc', serviceVersion: 42, environment: '', endpoint: null },
    );
    expect(config.serviceVersion).toBeUndefined();
    expect(config.environment).toBeUndefined();
    expect(config.endpoint).toBeUndefined();
  });

  it('parses headers from a delimited env-style string', () => {
    const config = resolveConfig(
      {},
      { serviceName: 'svc', headers: 'x-api-key=abc,x-tenant=nebula' },
    );
    expect(config.headers).toEqual({ 'x-api-key': 'abc', 'x-tenant': 'nebula' });
  });

  it('accepts headers already given as a Record<string,string>', () => {
    const config = resolveConfig({}, { serviceName: 'svc', headers: { a: '1' } });
    expect(config.headers).toEqual({ a: '1' });
  });

  it('drops non-string values when headers is an object with mixed value types', () => {
    const config = resolveConfig({}, { serviceName: 'svc', headers: { keep: 'yes', drop: 123 } });
    expect(config.headers).toEqual({ keep: 'yes' });
  });

  it('treats a headers object with only non-string values as absent', () => {
    const config = resolveConfig({}, { serviceName: 'svc', headers: { drop: 123 } });
    expect(config.headers).toBeUndefined();
  });

  it('ignores unsupported header source types (array, number)', () => {
    expect(resolveConfig({}, { serviceName: 'svc', headers: [1, 2] }).headers).toBeUndefined();
    expect(resolveConfig({}, { serviceName: 'svc', headers: 42 }).headers).toBeUndefined();
  });

  it('skips malformed entries in a delimited string (no "=", empty key, empty segment)', () => {
    const config = resolveConfig(
      {},
      { serviceName: 'svc', headers: 'valid=ok,,novalue,=emptykey,  ,also=fine' },
    );
    expect(config.headers).toEqual({ valid: 'ok', also: 'fine' });
  });

  it('treats an all-malformed delimited string as absent', () => {
    const config = resolveConfig({}, { serviceName: 'svc', headers: ',,=x,' });
    expect(config.headers).toBeUndefined();
  });

  it('overrides.headers wins over source.headers entirely (no merge)', () => {
    const config = resolveConfig(
      { headers: { override: 'yes' } },
      { serviceName: 'svc', headers: { source: 'yes' } },
    );
    expect(config.headers).toEqual({ override: 'yes' });
  });

  it('parses resourceAttributes from a delimited env-style string as strings', () => {
    const config = resolveConfig(
      {},
      { serviceName: 'svc', resourceAttributes: 'region=us-east-1,tier=gold' },
    );
    expect(config.resourceAttributes).toEqual({ region: 'us-east-1', tier: 'gold' });
  });

  it('accepts resourceAttributes as an object with string/number/boolean values', () => {
    const config = resolveConfig(
      {},
      {
        serviceName: 'svc',
        resourceAttributes: { region: 'us-east-1', replicas: 3, canary: true },
      },
    );
    expect(config.resourceAttributes).toEqual({ region: 'us-east-1', replicas: 3, canary: true });
  });

  it('treats an all-malformed resourceAttributes delimited string as absent', () => {
    const config = resolveConfig({}, { serviceName: 'svc', resourceAttributes: ',,=x,' });
    expect(config.resourceAttributes).toBeUndefined();
  });

  it('drops unsupported-type values from a resourceAttributes object', () => {
    const config = resolveConfig(
      {},
      { serviceName: 'svc', resourceAttributes: { keep: 'x', drop: { nested: true } } },
    );
    expect(config.resourceAttributes).toEqual({ keep: 'x' });
  });

  it('treats a resourceAttributes object with only unsupported values as absent', () => {
    const config = resolveConfig(
      {},
      { serviceName: 'svc', resourceAttributes: { drop: { nested: true } } },
    );
    expect(config.resourceAttributes).toBeUndefined();
  });

  it('ignores unsupported resourceAttributes source types', () => {
    expect(
      resolveConfig({}, { serviceName: 'svc', resourceAttributes: 42 }).resourceAttributes,
    ).toBeUndefined();
  });

  it('merges source.resourceAttributes and overrides.resourceAttributes, overrides winning on conflict', () => {
    const config = resolveConfig(
      { resourceAttributes: { region: 'override-region', extra: 'x' } },
      { serviceName: 'svc', resourceAttributes: 'region=source-region,tier=gold' },
    );
    expect(config.resourceAttributes).toEqual({
      region: 'override-region',
      tier: 'gold',
      extra: 'x',
    });
  });

  it('omits resourceAttributes when neither source nor overrides provide any', () => {
    const config = resolveConfig({}, { serviceName: 'svc' });
    expect(config.resourceAttributes).toBeUndefined();
  });

  it('propagates NebulaConfigError issues for a downstream-invalid merged value', () => {
    try {
      resolveConfig({ sampling: { ratio: 5 } }, { serviceName: 'svc' });
      expect.unreachable('expected resolveConfig to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(NebulaConfigError);
    }
  });
});
