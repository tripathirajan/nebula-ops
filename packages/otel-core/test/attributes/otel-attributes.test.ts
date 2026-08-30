import { describe, it, expect } from 'vitest';
import { OtelAttributes } from '../../src/attributes/otel-attributes.js';

describe('OtelAttributes', () => {
  it('pins every key to its standard semantic-conventions value', () => {
    expect(OtelAttributes.SERVICE_NAME).toBe('service.name');
    expect(OtelAttributes.SERVICE_VERSION).toBe('service.version');
    expect(OtelAttributes.DEPLOYMENT_ENVIRONMENT).toBe('deployment.environment');
    expect(OtelAttributes.TELEMETRY_DISTRO_NAME).toBe('telemetry.distro.name');
    expect(OtelAttributes.TELEMETRY_DISTRO_VERSION).toBe('telemetry.distro.version');
  });
});
