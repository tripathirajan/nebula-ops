/**
 * Internal helpers shared across otel-core's modules. Not part of the public API
 * surface (docs/package-specs/otel-core.md) — never re-exported from src/index.ts.
 */

/**
 * Returns a shallow copy of `obj` with every key whose value is `undefined`
 * removed. Needed because the repo's tsconfig enables `exactOptionalPropertyTypes`,
 * which treats `{ foo: undefined }` as distinct from `{}` for a `foo?: T` field —
 * config objects built up conditionally (e.g. "only include serviceVersion if one
 * was actually provided") must not carry explicit `undefined` values through to the
 * object literal that gets returned as a `NebulaOtelConfig`.
 */
export function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const result = {} as T;
  for (const key of Object.keys(obj) as Array<keyof T>) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
}

/** True for a non-null, non-array plain object — used to distinguish "already a
 * Record<string, ...>" config values from raw strings that still need parsing. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
