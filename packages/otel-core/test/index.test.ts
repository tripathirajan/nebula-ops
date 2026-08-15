import { describe, it, expect } from 'vitest';
import * as otelCore from '../src/index.js';

// Not a coverage target (src/index.ts is excluded from coverage thresholds — see
// vitest.config.ts — since it's a pure re-export barrel with no branches of its
// own). This is a regression check that every export the frozen spec
// (docs/package-specs/otel-core.md) promises actually resolves through the barrel.
describe('otel-core public barrel', () => {
  it('exports every function/value promised by docs/package-specs/otel-core.md', () => {
    expect(typeof otelCore.resolveConfig).toBe('function');
    expect(typeof otelCore.validateConfig).toBe('function');
    expect(typeof otelCore.NebulaConfigError).toBe('function'); // class
    expect(typeof otelCore.buildResource).toBe('function');
    expect(typeof otelCore.NebulaAttributes).toBe('object');
    expect(typeof otelCore.getActiveLogContext).toBe('function');
    expect(typeof otelCore.runWithLogContext).toBe('function');
    expect(typeof otelCore.bindLogContext).toBe('function');
    expect(typeof otelCore.logContextFromActiveSpan).toBe('function');
    expect(typeof otelCore.OTEL_CORE_VERSION).toBe('string');
  });
});
