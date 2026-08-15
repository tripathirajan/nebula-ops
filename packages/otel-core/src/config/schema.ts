import { z } from 'zod';
import { NebulaConfigError, type NebulaConfigIssue } from './errors.js';

/**
 * The config shape owned by otel-core and consumed by both otel-node and otel-web
 * (docs/architecture.md §3). This is the frozen public surface from
 * docs/package-specs/otel-core.md — do not change a field's name or type here
 * without updating that spec first (CLAUDE.md's non-negotiable rules).
 */
export interface NebulaOtelConfig {
  serviceName: string;
  serviceVersion?: string;
  environment?: string;
  endpoint?: string;
  headers?: Record<string, string>;
  resourceAttributes?: Record<string, string | number | boolean>;
  sampling?: {
    ratio?: number;
  };
}

/** Default sampling ratio when none is supplied anywhere — see
 * docs/adr/0002-open-questions-resolutions.md #2 for why this is 1.0 rather than a
 * pre-guessed production value. */
export const DEFAULT_SAMPLING_RATIO = 1.0;

// This schema is the single source of truth for what's a *valid* NebulaOtelConfig
// (required/optional-ness, string non-emptiness, the 0-1 sampling ratio range).
// It deliberately does not double as the source of the exported `NebulaOtelConfig`
// TypeScript type via z.infer — zod's `.optional()` fields infer as `T | undefined`,
// which reads fine but is a different shape than the hand-written interface above
// once `exactOptionalPropertyTypes` is in play. Keeping the two independent (and
// covered by the config.roundtrips-cleanly tests) avoids that friction while still
// giving every field real runtime validation.
const nebulaOtelConfigSchema = z.object({
  serviceName: z.string().min(1, 'serviceName is required and must be non-empty'),
  serviceVersion: z.string().min(1).optional(),
  environment: z.string().min(1).optional(),
  endpoint: z.string().min(1).optional(),
  headers: z.record(z.string()).optional(),
  resourceAttributes: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  sampling: z
    .object({
      ratio: z
        .number()
        .min(0, 'sampling.ratio must be between 0 and 1')
        .max(1, 'sampling.ratio must be between 0 and 1')
        .optional(),
    })
    .optional(),
});

/**
 * Validates an arbitrary value against the `NebulaOtelConfig` shape, returning a
 * clean, type-safe `NebulaOtelConfig` on success. Throws {@link NebulaConfigError}
 * (never a raw zod error — callers should never need to import zod themselves) with
 * every failing field listed, not just the first.
 */
export function validateConfig(input: unknown): NebulaOtelConfig {
  const result = nebulaOtelConfigSchema.safeParse(input);
  if (!result.success) {
    const issues: NebulaConfigIssue[] = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new NebulaConfigError(issues);
  }

  const parsed = result.data;
  // Built via conditional spread, not `field: parsed.field` for every optional
  // field, so a field whose value is `undefined` is fully absent from the returned
  // object rather than present-with-value-undefined — required for this to satisfy
  // `NebulaOtelConfig` under the repo's `exactOptionalPropertyTypes` tsconfig
  // setting (see src/internal/object-utils.ts's doc comment for the same rule
  // elsewhere; `stripUndefined` alone doesn't narrow the *type* of its result, only
  // the runtime shape, so it isn't sufficient here where the return type is
  // strictly `NebulaOtelConfig`, not `unknown`).
  const config: NebulaOtelConfig = {
    serviceName: parsed.serviceName,
    ...(parsed.serviceVersion !== undefined ? { serviceVersion: parsed.serviceVersion } : {}),
    ...(parsed.environment !== undefined ? { environment: parsed.environment } : {}),
    ...(parsed.endpoint !== undefined ? { endpoint: parsed.endpoint } : {}),
    ...(parsed.headers !== undefined ? { headers: parsed.headers } : {}),
    ...(parsed.resourceAttributes !== undefined
      ? { resourceAttributes: parsed.resourceAttributes }
      : {}),
    ...(parsed.sampling !== undefined
      ? {
          sampling: parsed.sampling.ratio !== undefined ? { ratio: parsed.sampling.ratio } : {},
        }
      : {}),
  };
  return config;
}
