import { describe, it, expect } from 'vitest';
import { validateConfig, DEFAULT_SAMPLING_RATIO } from '../../src/config/schema.js';
import { NebulaConfigError } from '../../src/config/errors.js';

describe('validateConfig', () => {
  it('accepts a minimal config with only serviceName', () => {
    const config = validateConfig({ serviceName: 'checkout-service' });
    expect(config).toEqual({ serviceName: 'checkout-service' });
  });

  it('accepts and preserves every optional field when provided', () => {
    const input = {
      serviceName: 'checkout-service',
      serviceVersion: '1.2.3',
      environment: 'production',
      endpoint: 'https://otel-collector.internal:4318',
      headers: { 'x-api-key': 'abc' },
      resourceAttributes: { region: 'us-east-1', replicas: 3, canary: true },
      sampling: { ratio: 0.25 },
    };
    expect(validateConfig(input)).toEqual(input);
  });

  it('omits sampling entirely when input has no sampling key', () => {
    const config = validateConfig({ serviceName: 'svc' });
    expect(config).not.toHaveProperty('sampling');
  });

  it('returns an empty sampling object when sampling is present but ratio is not', () => {
    const config = validateConfig({ serviceName: 'svc', sampling: {} });
    expect(config).toHaveProperty('sampling');
    expect(config.sampling).toEqual({});
  });

  it('throws NebulaConfigError when serviceName is missing', () => {
    expect(() => validateConfig({})).toThrow(NebulaConfigError);
  });

  it('throws NebulaConfigError when serviceName is an empty string', () => {
    expect(() => validateConfig({ serviceName: '' })).toThrow(NebulaConfigError);
  });

  it('throws NebulaConfigError when serviceName is the wrong type', () => {
    expect(() => validateConfig({ serviceName: 42 })).toThrow(NebulaConfigError);
  });

  it('throws NebulaConfigError when sampling.ratio is above 1', () => {
    try {
      validateConfig({ serviceName: 'svc', sampling: { ratio: 1.5 } });
      expect.unreachable('expected validateConfig to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(NebulaConfigError);
      expect((err as InstanceType<typeof NebulaConfigError>).issues).toEqual([
        { path: 'sampling.ratio', message: 'sampling.ratio must be between 0 and 1' },
      ]);
    }
  });

  it('throws NebulaConfigError when sampling.ratio is below 0', () => {
    expect(() => validateConfig({ serviceName: 'svc', sampling: { ratio: -0.1 } })).toThrow(
      NebulaConfigError,
    );
  });

  it('throws NebulaConfigError with one issue per invalid field, not just the first', () => {
    try {
      validateConfig({ serviceName: '', sampling: { ratio: 2 } });
      expect.unreachable('expected validateConfig to throw');
    } catch (err) {
      const issues = (err as InstanceType<typeof NebulaConfigError>).issues;
      expect(issues.length).toBeGreaterThanOrEqual(2);
      expect(issues.some((i) => i.path === 'serviceName')).toBe(true);
      expect(issues.some((i) => i.path === 'sampling.ratio')).toBe(true);
    }
  });

  it('throws NebulaConfigError for a non-object input', () => {
    expect(() => validateConfig('not a config')).toThrow(NebulaConfigError);
  });

  it('throws NebulaConfigError for null input', () => {
    expect(() => validateConfig(null)).toThrow(NebulaConfigError);
  });

  it('rejects resourceAttributes values of an unsupported type', () => {
    expect(() =>
      validateConfig({
        serviceName: 'svc',
        resourceAttributes: { bad: { nested: true } },
      }),
    ).toThrow(NebulaConfigError);
  });

  it('DEFAULT_SAMPLING_RATIO is 1.0 per ADR 0002 #2', () => {
    expect(DEFAULT_SAMPLING_RATIO).toBe(1.0);
  });
});
