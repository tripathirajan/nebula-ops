import { describe, it, expect } from 'vitest';
import { trace, context, TraceFlags, type Span } from '@opentelemetry/api';
import { createPinoMixin } from '../../src/logging/pino-mixin.js';

function createFakeSpan(): Span {
  return {
    spanContext: () => ({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: TraceFlags.SAMPLED,
    }),
  } as unknown as Span;
}

describe('createPinoMixin', () => {
  it('returns a function', () => {
    expect(typeof createPinoMixin()).toBe('function');
  });

  it('returns {} when there is no active span', () => {
    const mixin = createPinoMixin();
    expect(mixin()).toEqual({});
  });

  it('returns trace_id/span_id/trace_flags when a span is active', () => {
    const mixin = createPinoMixin();
    const span = createFakeSpan();
    const result = context.with(trace.setSpan(context.active(), span), () => mixin());
    expect(result).toEqual({
      trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
      span_id: '00f067aa0ba902b7',
      trace_flags: TraceFlags.SAMPLED,
    });
  });

  it('a fresh call to createPinoMixin returns an independently-usable function', () => {
    const mixinA = createPinoMixin();
    const mixinB = createPinoMixin();
    expect(mixinA()).toEqual(mixinB());
  });
});
