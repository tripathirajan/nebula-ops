import { describe, it, expect } from 'vitest';
import { buildResource } from '../../src/resource/build-resource.js';
import { NebulaAttributes } from '../../src/attributes/nebula-attributes.js';
import { OTEL_CORE_VERSION } from '../../src/version.js';
import type { NebulaOtelConfig } from '../../src/config/schema.js';

describe('buildResource', () => {
  it('sets service.name and the nebula package-version attribute from a minimal config', () => {
    const resource = buildResource({ serviceName: 'checkout-service' });
    expect(resource.attributes[NebulaAttributes.SERVICE_NAME]).toBe('checkout-service');
    expect(resource.attributes[NebulaAttributes.NEBULA_PACKAGE_VERSION]).toBe(OTEL_CORE_VERSION);
  });

  it('omits service.version and deployment.environment when not provided', () => {
    const resource = buildResource({ serviceName: 'svc' });
    expect(resource.attributes[NebulaAttributes.SERVICE_VERSION]).toBeUndefined();
    expect(resource.attributes[NebulaAttributes.DEPLOYMENT_ENVIRONMENT]).toBeUndefined();
  });

  it('includes service.version and deployment.environment when provided', () => {
    const config: NebulaOtelConfig = {
      serviceName: 'svc',
      serviceVersion: '1.2.3',
      environment: 'production',
    };
    const resource = buildResource(config);
    expect(resource.attributes[NebulaAttributes.SERVICE_VERSION]).toBe('1.2.3');
    expect(resource.attributes[NebulaAttributes.DEPLOYMENT_ENVIRONMENT]).toBe('production');
  });

  it('merges in explicit resourceAttributes', () => {
    const resource = buildResource({
      serviceName: 'svc',
      resourceAttributes: { region: 'us-east-1', replicas: 3, canary: true },
    });
    expect(resource.attributes.region).toBe('us-east-1');
    expect(resource.attributes.replicas).toBe(3);
    expect(resource.attributes.canary).toBe(true);
  });

  it('lets explicit resourceAttributes override a derived attribute', () => {
    const resource = buildResource({
      serviceName: 'svc',
      resourceAttributes: { [NebulaAttributes.SERVICE_NAME]: 'overridden-name' },
    });
    expect(resource.attributes[NebulaAttributes.SERVICE_NAME]).toBe('overridden-name');
  });
});
