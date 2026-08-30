import type { FastifyRequest } from 'fastify';
import { trace, context } from '@nebula-ops/otel-node';
import { ATTR_HTTP_ROUTE } from '@opentelemetry/semantic-conventions';

/**
 * Enriches the currently active span (the `SERVER` span
 * `@opentelemetry/instrumentation-http` already created for this request, via
 * `otel-node`'s default instrumentation set — see this package's Non-goals) with
 * the matched Fastify route *pattern* (e.g. `/orders/:id`), not the raw request
 * URL. Runs as an `onRequest` hook — by that point Fastify has already matched the
 * route, so `request.routeOptions.url` is populated.
 *
 * Uses the standard `http.route` semantic-convention key
 * (`@opentelemetry/semantic-conventions`'s `ATTR_HTTP_ROUTE`) and also updates the
 * span's name to `"<METHOD> <route>"` (e.g. `"GET /orders/:id"`) — the generic HTTP
 * instrumentation alone only knows the method, not Fastify's routing, so its
 * default span name is just `"GET"` for every route until enriched like this. Does
 * nothing (silently) if no span is active — see this package's `plugin.ts` for why
 * that's expected in some registration orders, not an error.
 */
export function applyRoutePattern(request: FastifyRequest): void {
  const span = trace.getSpan(context.active());
  if (!span) return;

  const routePattern = request.routeOptions.url;
  if (!routePattern) return; // no matched route (e.g. Fastify's own 404 handler)

  span.setAttribute(ATTR_HTTP_ROUTE, routePattern);
  span.updateName(`${request.method} ${routePattern}`);
}
