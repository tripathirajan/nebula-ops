import { describe, it, expect } from 'vitest';
import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import { applyErrorCapture } from '../../src/hooks/error-capture.js';
import { createTestTracing } from '../helpers/tracer.js';

describe('applyErrorCapture', () => {
  it('does nothing when there is no active span', () => {
    expect(() => applyErrorCapture(new Error('boom'))).not.toThrow();
  });

  it('records the exception and sets ERROR status with the error message', () => {
    const { tracer, exporter } = createTestTracing();
    const span = tracer.startSpan('GET /orders/:id');
    context.with(trace.setSpan(context.active(), span), () => {
      applyErrorCapture(new Error('order not found'));
    });
    span.end();

    const exported = exporter.getFinishedSpans()[0]!;
    expect(exported.status.code).toBe(SpanStatusCode.ERROR);
    expect(exported.status.message).toBe('order not found');
    expect(exported.events).toHaveLength(1);
    expect(exported.events[0]?.name).toBe('exception');
    expect(exported.events[0]?.attributes?.['exception.message']).toBe('order not found');
  });
});
