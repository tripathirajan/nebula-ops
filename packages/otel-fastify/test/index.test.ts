import { describe, it, expect } from 'vitest';
import * as otelFastify from '../src/index.js';

// Not a coverage target (src/index.ts is excluded — pure re-export barrel). A
// regression check that every export the frozen spec
// (docs/package-specs/otel-fastify.md) promises resolves through the barrel.
describe('otel-fastify public barrel', () => {
  it('exports everything promised by docs/package-specs/otel-fastify.md', () => {
    expect(typeof otelFastify.otelFastifyPlugin).toBe('function');
    expect(typeof otelFastify.default).toBe('function');
    expect(otelFastify.default).toBe(otelFastify.otelFastifyPlugin);
    expect(typeof otelFastify.otelFastifyLoggerOptions).toBe('function');
    expect(typeof otelFastify.OTEL_FASTIFY_VERSION).toBe('string');
  });
});
