import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import type { ContextManager } from '@opentelemetry/api';

/**
 * Builds the default Node `ContextManager` — `AsyncLocalStorageContextManager`,
 * per docs/concepts/02-otel-node.md §2.3 and the frozen default in
 * docs/package-specs/otel-node.md. This is the Node-specific half of the
 * log-context story: `otel-core`'s `runWithLogContext`/`getActiveLogContext` only
 * work correctly across async boundaries once a real `ContextManager` like this one
 * is installed — see docs/concepts/01-fundamentals.md §1.8.
 *
 * Does not call `.enable()` itself — the caller (`startNodeSdk`) is responsible for
 * registering it via `NodeSDK`'s `contextManager` option, which installs it as the
 * process-wide global context manager when `sdk.start()` runs.
 */
export function createDefaultContextManager(): ContextManager {
  return new AsyncLocalStorageContextManager();
}
