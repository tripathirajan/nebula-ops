import { context, createContextKey } from '@opentelemetry/api';
import { logContextFromActiveSpan } from './from-span.js';
import type { LogContext } from './types.js';

export type { LogContext } from './types.js';

// A well-known key into the generic OTel `Context` carrier (chapter 1 §1.5 of the
// concepts primer: Context is a generic key-value bag; "active span" is just one
// thing stored in it under its own key — this is the same mechanism, storing an
// explicit LogContext under a different, otel-core-owned key). Module-scoped
// singleton, not exported — callers only ever interact with it through
// runWithLogContext/getActiveLogContext, never the raw key.
const LOG_CONTEXT_KEY = createContextKey('nebula.otel.logContext');

/**
 * Reads whatever `LogContext` is active right now: the merge of (a) whatever the
 * active span's trace/span id resolve to, via {@link logContextFromActiveSpan}, and
 * (b) any custom fields explicitly set via {@link runWithLogContext}, which take
 * precedence over (a) for any field they both set (letting a caller deliberately
 * override `traceId`/`spanId` — useful in tests, or when correlating against a
 * trace context that didn't come from an OTel span at all).
 *
 * Returns `{}` if neither is present — never throws, per the "fails safe/empty, not
 * wrong" rule documented in docs/concepts/04-logging-integration.md §4.4.
 */
export function getActiveLogContext(): LogContext {
  const fromSpan = logContextFromActiveSpan();
  const explicit = context.active().getValue(LOG_CONTEXT_KEY) as LogContext | undefined;
  if (!explicit) return fromSpan;

  const mergedAttributes =
    fromSpan.attributes || explicit.attributes
      ? { ...fromSpan.attributes, ...explicit.attributes }
      : undefined;

  return {
    ...fromSpan,
    ...explicit,
    // Conditional spread (not `attributes: mergedAttributes`) so the key is fully
    // absent — not present-with-value-undefined — when there's nothing to merge;
    // required because the repo's tsconfig enables `exactOptionalPropertyTypes`
    // (see src/internal/object-utils.ts's doc comment for the same rule elsewhere).
    ...(mergedAttributes ? { attributes: mergedAttributes } : {}),
  };
}

/**
 * Runs `fn` with `logContext` merged onto (and taking precedence over) whatever
 * `LogContext` was already active, visible to any nested `getActiveLogContext()`
 * call for the duration of `fn` — including in code `fn` calls, per the standard
 * OTel context-propagation model (docs/concepts/01-fundamentals.md §1.5), as long as
 * a real `ContextManager` is installed (otel-node: `AsyncLocalStorageContextManager`;
 * otel-web: `StackContextManager`/`ZoneContextManager`). With no `ContextManager`
 * installed (e.g. a plain unit test with no SDK registered), `@opentelemetry/api`'s
 * built-in no-op context manager makes this synchronously scoped only — see
 * docs/concepts/01-fundamentals.md §1.8.
 */
export function runWithLogContext<T>(logContext: LogContext, fn: () => T): T {
  const current = (context.active().getValue(LOG_CONTEXT_KEY) as LogContext | undefined) ?? {};
  const mergedAttributes =
    current.attributes || logContext.attributes
      ? { ...current.attributes, ...logContext.attributes }
      : undefined;

  const merged: LogContext = {
    ...current,
    ...logContext,
    ...(mergedAttributes ? { attributes: mergedAttributes } : {}),
  };
  const nextContext = context.active().setValue(LOG_CONTEXT_KEY, merged);
  return context.with(nextContext, fn);
}

/**
 * Binds `fn` to whatever OTel `Context` (not just the `LogContext` slice of it) is
 * active at the moment `bindLogContext` is called, so that invoking the returned
 * function later re-enters that captured context even if it's called from code the
 * installed `ContextManager` wouldn't otherwise track (e.g. a raw `setTimeout` under
 * `StackContextManager` — docs/concepts/03-otel-web.md §3.4's documented gap). This
 * is a thin, log-context-flavored wrapper over `@opentelemetry/api`'s `context.bind`.
 */
export function bindLogContext<Args extends unknown[], R>(
  fn: (...args: Args) => R,
): (...args: Args) => R {
  return context.bind(context.active(), fn);
}
