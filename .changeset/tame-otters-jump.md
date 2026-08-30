---
'@nebula-ops/otel-node': minor
---

Initial implementation of `@nebula-ops/otel-node`: `startNodeSdk` assembles and
starts a `NodeSDK` from `otel-core`'s resolved config (explicit options >
`process.env` > defaults), with sensible defaults for every piece — OTLP/HTTP
trace exporter, `PeriodicExportingMetricReader`, `BatchLogRecordProcessor`,
`AsyncLocalStorageContextManager`, and the full `auto-instrumentations-node`
preset — each independently overridable via `NodeSdkOptions`.

`registerShutdownHandlers` wires `SIGTERM`/`SIGINT` to a bounded, idempotent
graceful shutdown so buffered telemetry isn't lost on process exit.
`createPinoMixin`/`createWinstonFormat` provide Pattern-A (correlation-only) log/
trace-context binding for pino and winston respectively, reading the active span
via `otel-core`'s `logContextFromActiveSpan`; both `pino` and `winston` are
optional peer dependencies, loaded (winston) or not needed at all (pino) lazily
so neither is required just to import the package.

100% test coverage (52 tests): `sdk/start.ts` tested by mocking every
collaborator to verify its own wiring logic precisely, independent of the real
SDK's behavior (which is covered where it actually lives — otel-core's tests and
this package's own `defaults.test.ts`); `sdk/shutdown.ts` tested with fake timers
and a mocked `process.exit` to safely exercise the timeout, duplicate-signal, and
shutdown-rejection paths without terminating the test process.
