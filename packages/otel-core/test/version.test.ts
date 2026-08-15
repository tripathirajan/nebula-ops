import { describe, it, expect } from 'vitest';
import { OTEL_CORE_VERSION } from '../src/version.js';
import pkg from '../package.json' with { type: 'json' };

describe('OTEL_CORE_VERSION', () => {
  it('matches package.json version', () => {
    expect(OTEL_CORE_VERSION).toBe(pkg.version);
  });

  it('is a non-empty string', () => {
    expect(typeof OTEL_CORE_VERSION).toBe('string');
    expect(OTEL_CORE_VERSION.length).toBeGreaterThan(0);
  });
});
