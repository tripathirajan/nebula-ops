import { describe, it, expect } from 'vitest';
import { trace, context, TraceFlags, type Span } from '@opentelemetry/api';
import { otelFastifyLoggerOptions } from '../src/logger-options.js';

function createFakeSpan(): Span {
  return {
    spanContext: () => ({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: TraceFlags.SAMPLED,
    }),
  } as unknown as Span;
}

describe('otelFastifyLoggerOptions', () => {
  it('returns an object with a mixin function', () => {
    const options = otelFastifyLoggerOptions();
    expect(typeof options.mixin).toBe('function');
  });

  it("the mixin reads the active span, exactly like otel-node's createPinoMixin", () => {
    const { mixin } = otelFastifyLoggerOptions();
    expect(mixin()).toEqual({});

    const span = createFakeSpan();
    const result = context.with(trace.setSpan(context.active(), span), () => mixin());
    expect(result).toEqual({
      trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
      span_id: '00f067aa0ba902b7',
      trace_flags: TraceFlags.SAMPLED,
    });
  });
});
