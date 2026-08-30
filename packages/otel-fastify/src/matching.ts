/** True if `routePattern` (Fastify's matched route, e.g. `/orders/:id` — not the
 * raw request URL) matches any entry in `ignoreRoutes`: an exact string match, or
 * `RegExp#test`. Used to let a consumer skip health-check-style routes entirely. */
export function isIgnoredRoute(
  routePattern: string,
  ignoreRoutes: ReadonlyArray<string | RegExp>,
): boolean {
  return ignoreRoutes.some((entry) =>
    typeof entry === 'string' ? entry === routePattern : entry.test(routePattern),
  );
}
