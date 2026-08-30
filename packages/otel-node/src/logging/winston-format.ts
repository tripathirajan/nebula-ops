import { createRequire } from 'node:module';
import type { Logform } from 'winston';
import { logContextFromActiveSpan } from '@nebula-ops/otel-core';

// `winston` is loaded lazily, via `require`, only when `createWinstonFormat()` is
// actually called — not as a static top-level import. `winston` is an optional
// peer dependency (docs/package-specs/otel-node.md's External dependencies table):
// a consumer who uses only pino (or neither logger) and never installed `winston`
// must still be able to import anything else from `otel-node`'s single barrel
// (src/index.ts) without a module-resolution error. A static `import winston from
// 'winston'` at the top of this file would defeat that, since ESM imports resolve
// eagerly at module-load time, not at call time.
//
// `createRequire(import.meta.url)` (rather than a bare `require`) is what makes
// this work under the package's ESM build output too, not just its CJS output —
// esbuild (via tsup) passes it through as real, working code in both output
// formats, unlike a bare `require(...)`, which would be left as literal (broken)
// text in the ESM output with no Node global to resolve it.
const requireFromHere = createRequire(import.meta.url);

/**
 * Returns a winston `Format` instance — pass it into
 * `winston.format.combine(createWinstonFormat(), ...)`. Pattern A correlation-only
 * logging (docs/concepts/04-logging-integration.md §4.1/§4.6): every log line gets
 * `trace_id`/`span_id`/`trace_flags` merged in from whatever span is active,
 * sourced from `otel-core`'s `logContextFromActiveSpan`.
 *
 * Throws the normal Node "Cannot find module 'winston'" error if called without
 * `winston` actually installed — expected and correct for an optional peer
 * dependency: the error only surfaces for a consumer who calls this specific
 * function, not merely for importing something else from the package.
 */
export function createWinstonFormat(): Logform.Format {
  // `typeof import('winston')` here is deliberately an inline type query on a
  // lazily `require`'d value, not something a top-level `import type` could
  // express — the whole point is that `winston` is never statically imported (see
  // the file-level comment above).
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const winston = requireFromHere('winston') as typeof import('winston');

  return winston.format((info) => {
    const logContext = logContextFromActiveSpan();
    if (logContext.traceId !== undefined) {
      info.trace_id = logContext.traceId;
      info.span_id = logContext.spanId;
      info.trace_flags = logContext.traceFlags;
    }
    return info;
  })();
}
