import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { ATTR_DEPLOYMENT_ENVIRONMENT } from '@opentelemetry/semantic-conventions/incubating';

/**
 * Resource/attribute key constants used throughout `@nebula-ops/otel`. Three of
 * these are direct re-exports of `@opentelemetry/semantic-conventions` constants
 * (so consumers get one consistent import rather than needing to know which
 * semconv keys are "stable" vs "incubating" subpath exports) plus one
 * nebula-specific key with no standard semconv equivalent.
 *
 * Deliberately exported as literal string constants (not just re-exporting the
 * semconv package's own exports under new names) so the *values* are pinned and
 * documented here even if a future semantic-conventions major version renames or
 * moves them upstream — see docs/architecture.md §5 on why `otel-core` treats
 * semconv as a regular (non-peer) dependency it fully owns the re-export of.
 */
export const NebulaAttributes = {
  SERVICE_NAME: ATTR_SERVICE_NAME,
  SERVICE_VERSION: ATTR_SERVICE_VERSION,
  DEPLOYMENT_ENVIRONMENT: ATTR_DEPLOYMENT_ENVIRONMENT,
  NEBULA_PACKAGE_VERSION: 'nebula.otel.package_version',
} as const satisfies {
  SERVICE_NAME: 'service.name';
  SERVICE_VERSION: 'service.version';
  DEPLOYMENT_ENVIRONMENT: 'deployment.environment';
  NEBULA_PACKAGE_VERSION: 'nebula.otel.package_version';
};
