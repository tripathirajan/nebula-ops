import { describe, it, expect } from 'vitest';
import { buildResource } from '../../src/resource/build-resource.js';
import { OtelAttributes } from '../../src/attributes/otel-attributes.js';
import { OTEL_CORE_VERSION } from '../../src/version.js';
import type { OtelConfig } from '../../src/config/schema.js';

describe('buildResource', () => {
  it('sets service.name and the telemetry.distro.* attributes from a minimal config', () => {
    const resource = buildResource({ serviceName: 'checkout-service' });
    expect(resource.attributes[OtelAttributes.SERVICE_NAME]).toBe('checkout-service');
    expect(resource.attributes[OtelAttributes.TELEMETRY_DISTRO_NAME]).toBe('@nebula-ops/otel-core');
    expect(resource.attributes[OtelAttributes.TELEMETRY_DISTRO_VERSION]).toBe(OTEL_CORE_VERSION);
  });

  it('omits service.version and deployment.environment when not provided', () => {
    const resource = buildResource({ serviceName: 'svc' });
    expect(resource.attributes[OtelAttributes.SERVICE_VERSION]).toBeUndefined();
    expect(resource.attributes[OtelAttributes.DEPLOYMENT_ENVIRONMENT]).toBeUndefined();
  });

  it('includes service.version and deployment.environment when provided', () => {
    const config: OtelConfig = {
      serviceName: 'svc',
      serviceVersion: '1.2.3',
      environment: 'production',
    };
    const resource = buildResource(config);
    expect(resource.attributes[OtelAttributes.SERVICE_VERSION]).toBe('1.2.3');
    expect(resource.attributes[OtelAttributes.DEPLOYMENT_ENVIRONMENT]).toBe('production');
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
      resourceAttributes: { [OtelAttributes.SERVICE_NAME]: 'overridden-name' },
    });
    expect(resource.attributes[OtelAttributes.SERVICE_NAME]).toBe('overridden-name');
  });
});
