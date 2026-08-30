# `node-app` example

A minimal Express service proving `@nebula-ops/otel-core` + `@nebula-ops/otel-node`
work end-to-end: auto-instrumentation, a manual span nested under it, error
recording, and trace-correlated pino logs. This is a demonstration, not a
production template — see [`../../docs/`](../../docs/) for the full design.

## Run it (zero setup)

```bash
pnpm install          # from the repo root
pnpm --filter node-app dev
```

By default this prints spans directly to the terminal (no OTel Collector needed) —
see `src/instrumentation.ts`. In another terminal:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/orders/123
curl http://localhost:3000/orders/missing   # the error path
```

Watch the first terminal: each request logs an incoming-request line, then (for
`/orders/*`) an `orders.fetch_from_store` span nested under the auto-instrumented
HTTP server span, then the pretty-printed pino log lines — every log line during a
request carries `trace_id`/`span_id` matching that request's spans, via
`createPinoMixin()` (`src/logger.ts`). Stop the server with Ctrl-C and you'll see it
wait briefly for `registerShutdownHandlers` to flush before exiting.

## What to look at, file by file

- **`src/instrumentation.ts`** — the entry point that must run before `express` (or
  anything else) is imported anywhere in the process; see the comment at its top and
  [`docs/concepts/02-otel-node.md`](../../docs/concepts/02-otel-node.md) §2.1 for why.
  Also shows the `traceExporter` override escape hatch in action (swapping the
  default OTLP exporter for `ConsoleSpanExporter`).
- **`src/logger.ts`** — the entire pino/otel-node integration is one option:
  `mixin: createPinoMixin()`.
- **`src/server.ts`** — `orders.fetch_from_store`'s manual span shows
  `startActiveSpan`, `setAttribute`, and the `recordException` + `setStatus` pairing
  from [`docs/concepts/02-otel-node.md`](../../docs/concepts/02-otel-node.md) §2.4 —
  hit `/orders/missing` to see the error path.

## Pointing this at a real OTel Collector instead

```bash
EXAMPLE_CONSOLE_EXPORT=false \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
pnpm --filter node-app dev
```

Point `OTEL_EXPORTER_OTLP_ENDPOINT` at any OTLP/HTTP-compatible Collector or backend
you already have running — this repo doesn't ship one (see
[ADR 0002 #2](../../docs/adr/0002-open-questions-resolutions.md#2-tail-based-sampling--collector-deployment-assumption):
a Collector is assumed to exist downstream, not provided by this repo's code).

## Config, the normal way

Every value `instrumentation.ts` hardcodes for convenience can instead come from env
vars, exactly as documented in
[`docs/architecture.md`](../../docs/architecture.md)'s config table — e.g.
`OTEL_SERVICE_NAME=node-app-example OTEL_ENVIRONMENT=local pnpm --filter node-app dev`
would work identically to the hardcoded `serviceName`/`environment` in
`instrumentation.ts`, since `startNodeSdk` resolves `process.env` itself.
