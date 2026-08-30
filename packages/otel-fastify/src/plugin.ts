import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { applyRoutePattern } from './hooks/route-pattern.js';
import { applyErrorCapture } from './hooks/error-capture.js';
import { isIgnoredRoute } from './matching.js';
import { OTEL_FASTIFY_VERSION } from './version.js';

/**
 * The frozen public option shape from docs/package-specs/otel-fastify.md.
 */
export interface OtelFastifyOptions {
  /** Set `http.route`/rename the active span to `"<METHOD> <route>"` using
   * Fastify's matched route pattern. Default `true`. */
  captureRoutePattern?: boolean;
  /** Record uncaught route errors (via Fastify's `onError` hook) as exception
   * events on the active span, and mark it as an error. Default `true`. */
  captureErrors?: boolean;
  /** Routes to skip entirely (matched against Fastify's route *pattern*, e.g.
   * `/healthz`, not the raw request URL) — exact string or `RegExp`. Default
   * `[]`. Useful for high-volume, low-value routes like health checks. */
  ignoreRoutes?: (string | RegExp)[];
}

function shouldSkip(request: FastifyRequest, ignoreRoutes: (string | RegExp)[]): boolean {
  const routePattern = request.routeOptions.url;
  return routePattern !== undefined && isIgnoredRoute(routePattern, ignoreRoutes);
}

/**
 * Registering this plugin (`fastify.register(otelFastifyPlugin, options)`) is the
 * only code change needed anywhere else in a Fastify app for route-pattern span
 * enrichment and automatic error recording — see docs/package-specs/otel-fastify.md's
 * Purpose section for what this deliberately does *not* cover (NodeSDK bootstrap,
 * which stays otel-node's separate `--require`/`--import` preload step, and
 * request-logger correlation, which needs `otelFastifyLoggerOptions()` passed into
 * `fastify()`'s own constructor instead — see `logger-options.ts`).
 *
 * Wrapped with `fastify-plugin` so its hooks apply at the root Fastify instance
 * scope regardless of where `.register()` is called from, rather than being
 * confined to a plugin encapsulation context.
 */
const plugin: FastifyPluginAsync<OtelFastifyOptions> = async (fastify, opts) => {
  const captureRoutePattern = opts.captureRoutePattern ?? true;
  const captureErrors = opts.captureErrors ?? true;
  const ignoreRoutes = opts.ignoreRoutes ?? [];

  if (captureRoutePattern) {
    fastify.addHook('onRequest', async (request) => {
      if (shouldSkip(request, ignoreRoutes)) return;
      applyRoutePattern(request);
    });
  }

  if (captureErrors) {
    fastify.addHook('onError', async (request, _reply, error) => {
      if (shouldSkip(request, ignoreRoutes)) return;
      applyErrorCapture(error);
    });
  }
};

export const otelFastifyPlugin = fp(plugin, {
  name: '@nebula-ops/otel-fastify',
  fastify: '5.x',
});

export default otelFastifyPlugin;

export { OTEL_FASTIFY_VERSION };
