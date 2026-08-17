import type { ConfigSource } from '@nebula-ops/otel-core';

/**
 * Gathers `process.env` into the `ConfigSource` shape `otel-core`'s `resolveConfig`
 * expects (docs/architecture.md §3's env-var table). This is the *only* place in
 * `otel-node` that reads `process.env` for config purposes — `otel-core` itself
 * never does (it's environment-agnostic), per CLAUDE.md's non-negotiable rules.
 *
 * `serviceVersion`'s "falls back to the consuming app's package.json version when
 * available" behavior (docs/architecture.md §3) is implemented via
 * `process.env.npm_package_version` — the standard variable npm/pnpm/yarn inject
 * automatically into a process started via a `package.json` script — rather than
 * walking the filesystem for the nearest `package.json` (which would need `fs`
 * access this module already has available, being Node-only, but adds real
 * complexity and fragility — e.g. monorepo package boundaries — for a "best-effort"
 * fallback). This only populates when the process was actually started via an
 * npm-family script; otherwise `serviceVersion` is simply left for the caller to
 * supply explicitly.
 */
export function gatherEnvConfigSource(env: NodeJS.ProcessEnv = process.env): ConfigSource {
  const source: ConfigSource = {};

  if (env.OTEL_SERVICE_NAME !== undefined) source.serviceName = env.OTEL_SERVICE_NAME;

  const serviceVersion = env.NEBULA_OTEL_SERVICE_VERSION ?? env.npm_package_version;
  if (serviceVersion !== undefined) source.serviceVersion = serviceVersion;

  if (env.NEBULA_OTEL_ENVIRONMENT !== undefined) source.environment = env.NEBULA_OTEL_ENVIRONMENT;
  if (env.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined) source.endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (env.OTEL_EXPORTER_OTLP_HEADERS !== undefined) source.headers = env.OTEL_EXPORTER_OTLP_HEADERS;
  if (env.OTEL_RESOURCE_ATTRIBUTES !== undefined) {
    source.resourceAttributes = env.OTEL_RESOURCE_ATTRIBUTES;
  }
  if (env.NEBULA_OTEL_SAMPLING_RATIO !== undefined) {
    source.samplingRatio = env.NEBULA_OTEL_SAMPLING_RATIO;
  }

  return source;
}
