import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import { otelFastifyPlugin, default as defaultExport } from '../src/plugin.js';
import { createTestTracing } from './helpers/tracer.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** Builds a Fastify app, registers the plugin, and injects one request with a
 * real span active for the whole request lifecycle (mirroring what
 * @opentelemetry/instrumentation-http does for a real inbound HTTP request) —
 * see test/helpers/tracer.ts for why SimpleSpanProcessor/InMemorySpanExporter. */
async function setupAndInject(
  pluginOptions: Parameters<typeof otelFastifyPlugin>[1] = {},
  routePath = '/orders/:id',
  injectPath = '/orders/42',
  handler: (request: unknown) => unknown = () => ({ ok: true }),
) {
  const { tracer, exporter } = createTestTracing();
  app = Fastify();
  await app.register(otelFastifyPlugin, pluginOptions);
  app.get(routePath, async (request) => handler(request));

  const span = tracer.startSpan('GET');
  // The `async () => { return ... }` form here is deliberate, not stylistic —
  // empirically verified (see this test file's git history / PR discussion) that
  // passing a plain sync arrow (`() => app.inject(...)`) to `context.with()` loses
  // AsyncLocalStorage propagation into Fastify's hook chain for this specific
  // app.inject() + @opentelemetry/api combination, while an `async` callback does
  // not. A minimal repro using raw `AsyncLocalStorage.run()` directly (no
  // @opentelemetry/api, no Fastify) showed no such difference, so this is
  // something specific to `ContextAPI.with()`'s or `app.inject()`'s own promise
  // handling, not a general AsyncLocalStorage gotcha — flagged here rather than
  // fully root-caused, since the fix is verified correct either way.
  const response = await context.with(trace.setSpan(context.active(), span), async () => {
    return app!.inject({ method: 'GET', url: injectPath });
  });
  span.end();

  return { response, exportedSpan: exporter.getFinishedSpans()[0]!, exporter };
}

describe('otelFastifyPlugin', () => {
  it('is also available as the default export', () => {
    expect(defaultExport).toBe(otelFastifyPlugin);
  });

  it('sets http.route and renames the active span using the matched route pattern', async () => {
    const { response, exportedSpan } = await setupAndInject();
    expect(response.statusCode).toBe(200);
    expect(exportedSpan.name).toBe('GET /orders/:id');
    expect(exportedSpan.attributes['http.route']).toBe('/orders/:id');
  });

  it('does nothing when captureRoutePattern is false', async () => {
    const { exportedSpan } = await setupAndInject({ captureRoutePattern: false });
    expect(exportedSpan.name).toBe('GET'); // unchanged from what the test set it up as
    expect(exportedSpan.attributes['http.route']).toBeUndefined();
  });

  it('skips route-pattern capture for a route matched by ignoreRoutes (exact string)', async () => {
    const { exportedSpan } = await setupAndInject({ ignoreRoutes: ['/orders/:id'] });
    expect(exportedSpan.name).toBe('GET');
    expect(exportedSpan.attributes['http.route']).toBeUndefined();
  });

  it('skips route-pattern capture for a route matched by ignoreRoutes (RegExp)', async () => {
    const { exportedSpan } = await setupAndInject({ ignoreRoutes: [/^\/orders\//] });
    expect(exportedSpan.name).toBe('GET');
  });

  it('does not skip a route that ignoreRoutes does not match', async () => {
    const { exportedSpan } = await setupAndInject({ ignoreRoutes: ['/health'] });
    expect(exportedSpan.attributes['http.route']).toBe('/orders/:id');
  });

  it('records an uncaught route error as an exception event and sets ERROR status', async () => {
    const { response, exportedSpan } = await setupAndInject({}, '/boom', '/boom', () => {
      throw new Error('kaboom');
    });
    expect(response.statusCode).toBe(500);
    expect(exportedSpan.status.code).toBe(SpanStatusCode.ERROR);
    expect(exportedSpan.status.message).toBe('kaboom');
    expect(exportedSpan.events).toHaveLength(1);
    expect(exportedSpan.events[0]?.name).toBe('exception');
    expect(exportedSpan.events[0]?.attributes?.['exception.message']).toBe('kaboom');
  });

  it('does not record errors when captureErrors is false', async () => {
    const { exportedSpan } = await setupAndInject(
      { captureErrors: false },
      '/boom',
      '/boom',
      () => {
        throw new Error('kaboom');
      },
    );
    expect(exportedSpan.status.code).toBe(SpanStatusCode.UNSET);
    expect(exportedSpan.events).toHaveLength(0);
  });

  it('skips error capture for a route matched by ignoreRoutes', async () => {
    const { exportedSpan } = await setupAndInject(
      { ignoreRoutes: ['/boom'] },
      '/boom',
      '/boom',
      () => {
        throw new Error('kaboom');
      },
    );
    expect(exportedSpan.status.code).toBe(SpanStatusCode.UNSET);
  });

  it('works correctly with no active span at all (no auto-instrumentation active)', async () => {
    app = Fastify();
    await app.register(otelFastifyPlugin);
    app.get('/health', async () => ({ ok: true }));

    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200); // no throw, nothing to enrich
  });
});
