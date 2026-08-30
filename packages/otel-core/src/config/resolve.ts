import { validateConfig, DEFAULT_SAMPLING_RATIO, type OtelConfig } from './schema.js';
import { stripUndefined, isPlainObject } from '../internal/object-utils.js';

/**
 * A plain bag of env-derived / build-time-injected values, gathered by the *caller*
 * (otel-node reads `process.env`; otel-web reads bundler-injected build-time
 * values) and handed to {@link resolveConfig}. otel-core itself never reads
 * `process.env` or any browser global — see docs/architecture.md §3.
 *
 * Recognized keys (all optional, all `unknown` until coerced): `serviceName`,
 * `serviceVersion`, `environment`, `endpoint`, `headers`, `resourceAttributes`,
 * `samplingRatio`. `headers`/`resourceAttributes` accept either an
 * already-parsed `Record<string, string>` or a raw
 * `"key1=value1,key2=value2"` string in the standard OTel env-var format (e.g.
 * `OTEL_EXPORTER_OTLP_HEADERS`) — resolveConfig parses the string form itself so
 * that parsing logic exists exactly once rather than being duplicated in every
 * environment package. Unrecognized keys are ignored, not an error — this keeps
 * `resolveConfig` forward-compatible with a caller that passes through its entire
 * environment rather than a hand-filtered subset.
 */
export interface ConfigSource {
  [key: string]: unknown;
}

function coerceString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** Parses the standard OTel env-var delimited format: `"k1=v1,k2=v2"`. Empty
 * segments and entries with no `=` are skipped rather than throwing — a
 * malformed env var should degrade to "that entry is missing," not crash config
 * resolution for the whole process. */
function parseDelimitedPairs(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const segment of raw.split(',')) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue; // no '=', or '=' is the first character (empty key)
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

function coerceStringRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value === 'string') {
    const parsed = parseDelimitedPairs(value);
    return Object.keys(parsed).length > 0 ? parsed : undefined;
  }
  if (isPlainObject(value)) {
    const result: Record<string, string> = {};
    for (const [key, val] of Object.entries(value)) {
      if (typeof val === 'string') result[key] = val;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }
  return undefined;
}

function coerceResourceAttributes(
  value: unknown,
): Record<string, string | number | boolean> | undefined {
  if (typeof value === 'string') {
    const parsed = parseDelimitedPairs(value);
    return Object.keys(parsed).length > 0 ? parsed : undefined;
  }
  if (isPlainObject(value)) {
    const result: Record<string, string | number | boolean> = {};
    for (const [key, val] of Object.entries(value)) {
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        result[key] = val;
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }
  return undefined;
}

function mergeRecords<V>(
  base: Record<string, V> | undefined,
  override: Record<string, V> | undefined,
): Record<string, V> | undefined {
  if (!base && !override) return undefined;
  return { ...base, ...override };
}

/**
 * Merges explicit `overrides` (highest precedence) over `source` (env-derived
 * values, e.g. from otel-node's `process.env` gathering) over built-in defaults
 * (lowest precedence), then validates the result — see docs/architecture.md §3 for
 * the full precedence/env-var table. Throws {@link ConfigError} if the merged
 * result is invalid (most commonly: no `serviceName` from either `overrides` or
 * `source`).
 */
export function resolveConfig(
  overrides: Partial<OtelConfig> = {},
  source: ConfigSource = {},
): OtelConfig {
  const resourceAttributes = mergeRecords(
    coerceResourceAttributes(source.resourceAttributes),
    overrides.resourceAttributes,
  );

  const ratio =
    overrides.sampling?.ratio ?? coerceNumber(source.samplingRatio) ?? DEFAULT_SAMPLING_RATIO;

  const merged = stripUndefined({
    serviceName: overrides.serviceName ?? coerceString(source.serviceName),
    serviceVersion: overrides.serviceVersion ?? coerceString(source.serviceVersion),
    environment: overrides.environment ?? coerceString(source.environment),
    endpoint: overrides.endpoint ?? coerceString(source.endpoint),
    headers: overrides.headers ?? coerceStringRecord(source.headers),
    resourceAttributes,
    sampling: { ratio },
  });

  return validateConfig(merged);
}
