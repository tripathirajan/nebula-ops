import { resourceFromAttributes, type Resource } from '@opentelemetry/resources';
import type { OtelConfig } from '../config/schema.js';
import { OtelAttributes } from '../attributes/otel-attributes.js';
import { OTEL_CORE_VERSION } from '../version.js';

/**
 * Maps a resolved `OtelConfig` to an OpenTelemetry `Resource`, using
 * `OtelAttributes`' semantic-convention-backed keys. `config.resourceAttributes`
 * (explicit, user-supplied) takes precedence over the values this function derives
 * from `serviceName`/`serviceVersion`/`environment` — see docs/architecture.md §3's
 * precedence table, which puts explicit config above everything else. It never
 * takes precedence over nothing, though: `otel-node`/`otel-web` layer their own
 * environment/host resource detectors *underneath* this (merged via `Resource#merge`
 * on the caller's side), since detector-derived attributes aren't config the way
 * `resourceAttributes` is.
 */
export function buildResource(config: OtelConfig): Resource {
  const derived: Record<string, string | number | boolean> = {
    [OtelAttributes.SERVICE_NAME]: config.serviceName,
    // Identifies @nebula-ops/otel-core itself as the instrumentation distro that
    // produced this telemetry, via the standard telemetry.distro.* pair — see
    // otel-attributes.ts's doc comment for why this isn't a proprietary key.
    [OtelAttributes.TELEMETRY_DISTRO_NAME]: '@nebula-ops/otel-core',
    [OtelAttributes.TELEMETRY_DISTRO_VERSION]: OTEL_CORE_VERSION,
  };

  if (config.serviceVersion !== undefined) {
    derived[OtelAttributes.SERVICE_VERSION] = config.serviceVersion;
  }
  if (config.environment !== undefined) {
    derived[OtelAttributes.DEPLOYMENT_ENVIRONMENT] = config.environment;
  }

  // Explicit resourceAttributes win over the derived values above (e.g. a caller
  // can override service.name's resource attribute independently of serviceName,
  // though that's an unusual thing to want — the precedence still holds either way).
  //
  // Uses `resourceFromAttributes` (the `@opentelemetry/resources` 2.x factory
  // function), not `new Resource(...)` — the 1.x `Resource` class constructor was
  // removed in the 2.x line; `Resource` is now a non-user-constructible interface,
  // per that package's own Resource.d.ts. See the version-correction note in
  // docs/package-specs/otel-core.md's External dependencies table for why this
  // package is pinned to 2.x rather than the ~1.26.0 originally spec'd.
  return resourceFromAttributes({ ...derived, ...config.resourceAttributes });
}
