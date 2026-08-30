// This file is loaded via `node --import ./src/instrumentation.ts ...` — BEFORE
// server.ts (or anything it imports, like `express`) — per
// docs/concepts/02-otel-node.md §2.1: auto-instrumentation patches modules at
// `require`/`import` time, so the SDK must be started before those modules are
// first loaded anywhere in the process. See package.json's `dev` script for the
// actual invocation.
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { startNodeSdk, registerShutdownHandlers } from '@nebula-ops/otel-node';

// Zero-setup by default: prints spans straight to this terminal so `pnpm dev`
// shows something immediately, with no OTel Collector required. Set
// EXAMPLE_CONSOLE_EXPORT=false (and OTEL_EXPORTER_OTLP_ENDPOINT, e.g. via the
// docker-compose Collector in this example's README) to send real OTLP instead —
// this is exactly the `traceExporter` override escape hatch documented in
// docs/package-specs/otel-node.md, not special example-only behavior.
const useConsoleExporter = process.env.EXAMPLE_CONSOLE_EXPORT !== 'false';

const sdk = startNodeSdk({
  serviceName: 'node-app-example', // could also come from OTEL_SERVICE_NAME — see README
  environment: 'local',
  ...(useConsoleExporter ? { traceExporter: new ConsoleSpanExporter() } : {}),
});

// Ensures buffered spans/logs/metrics are flushed on Ctrl-C / process termination
// instead of silently dropped — see docs/concepts/02-otel-node.md §2.5.
registerShutdownHandlers(sdk);

if (useConsoleExporter) {
  // eslint-disable-next-line no-console -- deliberate example-only startup banner
  console.log(
    '[instrumentation] Exporting spans to the console (EXAMPLE_CONSOLE_EXPORT=false to use OTLP instead — see README).',
  );
}
