import type { ConfigSource } from '@nebula-ops/otel-core';

/**
 * Gathers `process.env` into the `ConfigSource` shape `otel-core`'s `resolveConfig`
 * expects (docs/architecture.md §3's env-var table). This is the *only* place in
 * `otel-node` that reads `process.env` for config purposes — `otel-core` itself
 * never does (it's environment-agnostic), per CLAUDE.md's non-negotiable rules.
 *
 * `OTEL_SERVICE_VERSION`, `OTEL_ENVIRONMENT`, and `OTEL_SAMPLING_RATIO` are
 * **this project's own env vars, not part of the official OpenTelemetry spec** —
 * only `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_*`, and `OTEL_RESOURCE_ATTRIBUTES`
 * below are genuinely standard. The bare `OTEL_` prefix is nonetheless used for
 * these three (rather than a `NEBULA_OTEL_` prefix) per a deliberate, explicit
 * choice to keep the env-var surface visually consistent/generic — see the
 * "Env var naming" note in docs/architecture.md §3 for the trade-off this accepts
 * (a small risk of colliding with a same-named var the OTel spec might define later).
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

  const serviceVersion = env.OTEL_SERVICE_VERSION ?? env.npm_package_version;
  if (serviceVersion !== undefined) source.serviceVersion = serviceVersion;

  if (env.OTEL_ENVIRONMENT !== undefined) source.environment = env.OTEL_ENVIRONMENT;
  if (env.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined)
    source.endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (env.OTEL_EXPORTER_OTLP_HEADERS !== undefined) source.headers = env.OTEL_EXPORTER_OTLP_HEADERS;
  if (env.OTEL_RESOURCE_ATTRIBUTES !== undefined) {
    source.resourceAttributes = env.OTEL_RESOURCE_ATTRIBUTES;
  }
  if (env.OTEL_SAMPLING_RATIO !== undefined) {
    source.samplingRatio = env.OTEL_SAMPLING_RATIO;
  }

  return source;
}
