import { describe, it, expect } from 'vitest';
import { trace, context, TraceFlags, type Span } from '@opentelemetry/api';
import type { Logform } from 'winston';
import { createWinstonFormat } from '../../src/logging/winston-format.js';

type TransformableInfo = Logform.TransformableInfo;

function createFakeSpan(): Span {
  return {
    spanContext: () => ({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: TraceFlags.SAMPLED,
    }),
  } as unknown as Span;
}

function applyFormat(info: TransformableInfo): TransformableInfo {
  const format = createWinstonFormat();
  const result = format.transform(info, {});
  // A Format's transform can return `false` (drop the log line) per logform's
  // TransformFunction type — createWinstonFormat's implementation never does that,
  // it always returns the (possibly-augmented) info object.
  expect(result).not.toBe(false);
  return result as TransformableInfo;
}

describe('createWinstonFormat', () => {
  it('returns a winston Format instance with a transform function', () => {
    const format = createWinstonFormat();
    expect(typeof format.transform).toBe('function');
  });

  it('leaves the log info unchanged when there is no active span', () => {
    const info: TransformableInfo = { level: 'info', message: 'hello' };
    const result = applyFormat(info);
    expect(result).not.toHaveProperty('trace_id');
    expect(result.level).toBe('info');
    expect(result.message).toBe('hello');
  });

  it('adds trace_id/span_id/trace_flags when a span is active', () => {
    const span = createFakeSpan();
    const result = context.with(trace.setSpan(context.active(), span), () =>
      applyFormat({ level: 'info', message: 'hello' }),
    );
    expect(result.trace_id).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(result.span_id).toBe('00f067aa0ba902b7');
    expect(result.trace_flags).toBe(TraceFlags.SAMPLED);
  });

  it('a fresh call to createWinstonFormat produces an independently-usable format', () => {
    const infoA = applyFormat({ level: 'info', message: 'a' });
    const infoB = applyFormat({ level: 'info', message: 'b' });
    expect(infoA.message).toBe('a');
    expect(infoB.message).toBe('b');
  });
});
