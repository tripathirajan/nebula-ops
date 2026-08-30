import type { NodeSDK } from '@opentelemetry/sdk-node';

/** Bounded wait for `sdk.shutdown()` before giving up — see
 * docs/concepts/02-otel-node.md §2.5: "a bounded timeout so a stuck exporter can't
 * hang process shutdown indefinitely." Not exposed as a `registerShutdownHandlers`
 * parameter (the frozen signature takes only `sdk`) — a caller needing a different
 * value calls `shutdownNodeSdk` directly inside their own signal handler instead of
 * using `registerShutdownHandlers`. */
const SHUTDOWN_TIMEOUT_MILLIS = 5000;

/**
 * Flushes and shuts down every provider `sdk` registered (tracer, meter, logger),
 * per `NodeSDK#shutdown()`. Idempotent from the caller's perspective in the sense
 * that it's just a thin wrapper — repeated calls are `NodeSDK`'s own responsibility
 * to handle safely, not something this function adds logic for.
 */
export async function shutdownNodeSdk(sdk: NodeSDK): Promise<void> {
  await sdk.shutdown();
}

/**
 * Registers `SIGTERM`/`SIGINT` handlers that call {@link shutdownNodeSdk} (with a
 * bounded timeout, per the constant above) before exiting the process — see
 * docs/concepts/02-otel-node.md §2.5 for why this matters: without it, whatever
 * spans/logs/metrics are still buffered in a `BatchSpanProcessor`-style processor
 * at the moment the process exits are lost, typically the last handful right before
 * a crash — exactly the ones most useful for debugging it.
 *
 * Node's default behavior for `SIGTERM`/`SIGINT` is to exit the process; once *any*
 * listener is registered for these signals (as this function does), that default
 * no longer fires automatically, so this handler explicitly calls `process.exit()`
 * itself once shutdown finishes (or times out) — omitting that would leave the
 * process hanging on a received signal instead of exiting.
 *
 * Returns an unregister function — call it to remove these handlers (e.g. in a
 * test, or if the caller wants to install its own signal handling instead).
 */
export function registerShutdownHandlers(sdk: NodeSDK): () => void {
  let shuttingDown = false;

  const handleSignal = (): void => {
    if (shuttingDown) return; // a second SIGTERM/SIGINT during shutdown — ignore, already in progress
    shuttingDown = true;

    const timeout = setTimeout(() => {
      process.exit(1); // exporter didn't flush in time — exit anyway rather than hang forever
    }, SHUTDOWN_TIMEOUT_MILLIS);
    timeout.unref(); // doesn't itself keep the process alive if shutdown finishes first

    shutdownNodeSdk(sdk)
      .catch(() => {
        // Shutdown failed (e.g. exporter network error) — exit anyway; we were
        // already terminating the process, and there's nothing more useful this
        // handler can do with the error than what NodeSDK's own diagnostics already
        // surfaced (see docs/concepts/05-processing-and-batching.md §5.3).
      })
      .finally(() => {
        clearTimeout(timeout);
        process.exit(0);
      });
  };

  process.on('SIGTERM', handleSignal);
  process.on('SIGINT', handleSignal);

  return () => {
    process.off('SIGTERM', handleSignal);
    process.off('SIGINT', handleSignal);
  };
}
