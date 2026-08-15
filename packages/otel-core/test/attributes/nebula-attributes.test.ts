import { describe, it, expect } from 'vitest';
import { NebulaAttributes } from '../../src/attributes/nebula-attributes.js';

describe('NebulaAttributes', () => {
  it('pins the semantic-convention-backed keys to their standard values', () => {
    expect(NebulaAttributes.SERVICE_NAME).toBe('service.name');
    expect(NebulaAttributes.SERVICE_VERSION).toBe('service.version');
    expect(NebulaAttributes.DEPLOYMENT_ENVIRONMENT).toBe('deployment.environment');
  });

  it('defines the nebula-specific key with no standard semconv equivalent', () => {
    expect(NebulaAttributes.NEBULA_PACKAGE_VERSION).toBe('nebula.otel.package_version');
  });
});
