import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT,
  ATTR_TELEMETRY_DISTRO_NAME,
  ATTR_TELEMETRY_DISTRO_VERSION,
} from '@opentelemetry/semantic-conventions/incubating';

/**
 * Resource/attribute key constants used throughout `@nebula-ops/otel`. Every one
 * of these is a direct re-export of an `@opentelemetry/semantic-conventions`
 * constant (so consumers get one consistent import rather than needing to know
 * which semconv keys are "stable" vs "incubating" subpath exports) — there is no
 * invented, non-standard key here. In particular, identifying which package
 * produced a given piece of telemetry (this package's own former
 * `nebula.otel.package_version` attribute) is exactly what the standard
 * `telemetry.distro.name`/`telemetry.distro.version` pair is *for* — OTel's own
 * convention for "which instrumentation distribution generated this," used the
 * same way any vendor SDK stamps itself into telemetry it produces. Using it here
 * instead of a proprietary key means a backend that already understands
 * `telemetry.distro.*` (most do) surfaces this correctly with zero nebula-specific
 * handling on its end.
 *
 * Deliberately exported as literal string constants (not just re-exporting the
 * semconv package's own exports under new names) so the *values* are pinned and
 * documented here even if a future semantic-conventions major version renames or
 * moves them upstream — see docs/architecture.md §5 on why `otel-core` treats
 * semconv as a regular (non-peer) dependency it fully owns the re-export of.
 */
export const OtelAttributes = {
  SERVICE_NAME: ATTR_SERVICE_NAME,
  SERVICE_VERSION: ATTR_SERVICE_VERSION,
  DEPLOYMENT_ENVIRONMENT: ATTR_DEPLOYMENT_ENVIRONMENT,
  TELEMETRY_DISTRO_NAME: ATTR_TELEMETRY_DISTRO_NAME,
  TELEMETRY_DISTRO_VERSION: ATTR_TELEMETRY_DISTRO_VERSION,
} as const satisfies {
  SERVICE_NAME: 'service.name';
  SERVICE_VERSION: 'service.version';
  DEPLOYMENT_ENVIRONMENT: 'deployment.environment';
  TELEMETRY_DISTRO_NAME: 'telemetry.distro.name';
  TELEMETRY_DISTRO_VERSION: 'telemetry.distro.version';
};
