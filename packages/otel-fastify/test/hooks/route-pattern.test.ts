import { describe, it, expect } from 'vitest';
import { trace, context } from '@opentelemetry/api';
import type { FastifyRequest } from 'fastify';
import { applyRoutePattern } from '../../src/hooks/route-pattern.js';
import { createTestTracing } from '../helpers/tracer.js';

function fakeRequest(routeUrl: string | undefined, method = 'GET'): FastifyRequest {
  return {
    method,
    routeOptions: { url: routeUrl },
  } as unknown as FastifyRequest;
}

describe('applyRoutePattern', () => {
  it('does nothing when there is no active span', () => {
    // No context.with() wrapping — context.active() has no span.
    expect(() => applyRoutePattern(fakeRequest('/orders/:id'))).not.toThrow();
  });

  it('does nothing when routeOptions.url is undefined (e.g. an unmatched/404 route)', () => {
    const { tracer, exporter } = createTestTracing();
    const span = tracer.startSpan('GET');
    context.with(trace.setSpan(context.active(), span), () => {
      applyRoutePattern(fakeRequest(undefined));
    });
    span.end();
    expect(exporter.getFinishedSpans()[0]?.name).toBe('GET'); // unchanged
  });

  it('sets http.route and renames the span when both a span and a route are present', () => {
    const { tracer, exporter } = createTestTracing();
    const span = tracer.startSpan('GET');
    context.with(trace.setSpan(context.active(), span), () => {
      applyRoutePattern(fakeRequest('/orders/:id', 'GET'));
    });
    span.end();
    const exported = exporter.getFinishedSpans()[0]!;
    expect(exported.name).toBe('GET /orders/:id');
    expect(exported.attributes['http.route']).toBe('/orders/:id');
  });

  it('uses the request method in the renamed span name', () => {
    const { tracer, exporter } = createTestTracing();
    const span = tracer.startSpan('POST');
    context.with(trace.setSpan(context.active(), span), () => {
      applyRoutePattern(fakeRequest('/orders', 'POST'));
    });
    span.end();
    expect(exporter.getFinishedSpans()[0]?.name).toBe('POST /orders');
  });
});
