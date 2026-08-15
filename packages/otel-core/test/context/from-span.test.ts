import { describe, it, expect } from 'vitest';
import { context, trace, TraceFlags } from '@opentelemetry/api';
import { logContextFromActiveSpan } from '../../src/context/from-span.js';
import { createFakeSpan } from '../helpers/fake-span.js';

describe('logContextFromActiveSpan', () => {
  it('returns {} when there is no active span', () => {
    expect(logContextFromActiveSpan()).toEqual({});
  });

  it('returns the trace/span id and flags of the active span', () => {
    const span = createFakeSpan({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: TraceFlags.SAMPLED,
    });

    const result = context.with(trace.setSpan(context.active(), span), () =>
      logContextFromActiveSpan(),
    );

    expect(result).toEqual({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: TraceFlags.SAMPLED,
    });
  });

  it('reflects an unsampled span correctly', () => {
    const span = createFakeSpan({ traceFlags: TraceFlags.NONE });
    const result = context.with(trace.setSpan(context.active(), span), () =>
      logContextFromActiveSpan(),
    );
    expect(result.traceFlags).toBe(TraceFlags.NONE);
  });
});
