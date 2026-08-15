# 4. OpenTelemetry as a transport for existing logger libraries — concepts, tutorial, and scenarios

## 4.1 The core question

Teams almost always already have a logger (pino, winston, bunyan, or `console` in the
browser) with established call sites (`logger.info(...)`) throughout the codebase.
Adopting OTel for logs does **not** mean ripping that out. The question is how OTel
_relates_ to that existing logger — there are three distinct patterns, with different
trade-offs:

### Pattern A — Correlation only (no OTel Logs pipeline at all)

The existing logger keeps writing exactly as before, to exactly the same destination
(stdout, a file, a browser console) it always did. The _only_ change is: every log
line gets `trace_id`/`span_id` fields injected, sourced from whatever span is active
at the moment the log call happens. No `LoggerProvider`, no `LogRecordExporter`, no
OTel Logs SDK involved at all — this is pure "read the active span's context and
stick it into the log's structured fields." Code: §4.5–§4.7.

### Pattern B — Logs Bridge API (dual pipeline)

The existing logger still exists and still writes to its normal destination, **but**
an appender/transport is added that _also_ forwards each log record into the OTel
Logs pipeline (`LoggerProvider` → `LogRecordProcessor` → `LogRecordExporter` →
your OTel backend), in addition to (not instead of) the original output. This is
what "Logs Bridge API" formally refers to in the OTel spec — most languages'
implementations of it are less mature than the tracing/metrics SDKs (true of the JS
SDK at the versions pinned in this repo: `@opentelemetry/sdk-logs` and the
appender packages for pino/winston are usable but younger/less battle-tested than
`sdk-trace-node`). Code: §4.8.

### Pattern C — Full replacement (OTel Logs API is the only logger)

Application code calls the OTel Logs API directly (`logger.emit({...})`) instead of
pino/winston/console. Rare for teams with an established logger — mostly relevant for
new services with no legacy logging investment, or for library/infra code that wants
zero dependency on a specific logging library. Highest OTel-native consistency,
highest migration cost, most exposure to the Logs SDK's relative immaturity. Code: §4.9.

## 4.2 Which pattern fits which situation

| Situation                                                                                                              | Likely fit                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Established service, existing pino/winston pipeline already shipping logs somewhere that works                         | **A** — add correlation, change nothing else, near-zero risk                                                                                                                                                                                 |
| Team wants trace/log correlation _and_ a single OTel-native backend for both, willing to run/tune a second export path | **B**                                                                                                                                                                                                                                        |
| Greenfield service, or infra code with no existing logger dependency                                                   | **C**, or A if there's still a preferred existing logger for humans reading raw output                                                                                                                                                       |
| Browser                                                                                                                | Almost always **A** (console bridge) — a full OTel Logs pipeline from the browser adds another public-reachable exporter endpoint and payload-size cost (ch. 3 §3.10) for a signal that's usually lower-value client-side than traces/vitals |

## 4.3 Why correlation is the part that actually matters most

The single highest-value outcome of "OTel + logging" for most teams isn't moving log
_storage_ to OTel — it's making trace ID a **join key** between two systems that
otherwise have no relationship: "this request was slow (seen in the trace backend) —
what did the application actually log while handling it (seen in the log backend)?"
That join only requires Pattern A's `trace_id`/`span_id` field injection to exist.
Everything past that (full bridge, full replacement) is about _where logs live and
how they're queried_, not about correlation, which is why Pattern A is usually the
right default and B/C are opt-in upgrades for teams who specifically want a unified
backend.

## 4.4 What the SDK context read looks like, precisely

All three patterns rely on the same underlying primitive: reading the currently
active span from the OTel `context` API at the moment the log call happens
(`trace.getSpan(context.active())`), then reading that span's `traceId`, `spanId`,
and `traceFlags` off its `SpanContext`. This is why correlation is only as reliable
as context propagation itself (ch. 1 §1.5, ch. 2 §2.3, ch. 3 §3.4) — a log line
emitted from code the active `ContextManager` lost track of (e.g. inside browser code
untouched by `ZoneContextManager`/`StackContextManager`, or an unusual Node async
pattern) will correlate to no span, not the wrong one; it fails safe/empty rather
than silently wrong.

**Official references used in the code sections below:**

- Logs concepts: https://opentelemetry.io/docs/concepts/signals/logs/
- JS Logs Bridge API: https://opentelemetry.io/docs/languages/js/instrumentation/#logs
- `@opentelemetry/instrumentation-pino`: https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/plugins/node/opentelemetry-instrumentation-pino
- `@opentelemetry/instrumentation-winston`: https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/plugins/node/opentelemetry-instrumentation-winston
- `@opentelemetry/sdk-logs`: https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/sdk-logs
- Severity number spec: https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-severitynumber
- pino `mixin` option docs: https://getpino.io/#/docs/api?id=mixin

## 4.5 Pattern A — correlation only, with pino

```ts
import pino from 'pino';
import { trace, context } from '@opentelemetry/api';

const logger = pino({
  mixin() {
    const span = trace.getSpan(context.active());
    if (!span) return {};
    const { traceId, spanId, traceFlags } = span.spanContext();
    return { trace_id: traceId, span_id: spanId, trace_flags: traceFlags };
  },
});

// elsewhere, inside a traced request:
logger.info({ userId: '123' }, 'order created'); // now includes trace_id/span_id automatically
```

pino's `mixin` is called on **every** log call and its return value is shallow-merged
into that log line's fields — this is the entire mechanism, no pino internals
touched, no dependency beyond `@opentelemetry/api` for reading the active span.
`mixin` receiving no arguments in this simple form is intentional; pino also supports
a `mixin(mergeObject, level)` signature if you need the log's own level to affect
what gets mixed in (e.g. only attach trace context at `warn`+ to save bytes on `debug`
volume) — check the pino docs linked above for the current signature.

## 4.6 Pattern A — correlation only, with winston

```ts
import winston from 'winston';
import { trace, context } from '@opentelemetry/api';

const traceContextFormat = winston.format((info) => {
  const span = trace.getSpan(context.active());
  if (span) {
    const { traceId, spanId, traceFlags } = span.spanContext();
    info.trace_id = traceId;
    info.span_id = spanId;
    info.trace_flags = traceFlags;
  }
  return info;
});

const logger = winston.createLogger({
  format: winston.format.combine(traceContextFormat(), winston.format.json()),
  transports: [new winston.transports.Console()],
});
```

Winston formats are composable functions in a chain (`combine(...)`) — this one reads
the active span the same way as pino's `mixin`, just via winston's format-plugin
shape instead. Order matters: put `traceContextFormat()` **before** any format that
serializes the log to its final string form (e.g. `winston.format.json()`), since a
format can only add fields to the mutable `info` object before it's turned into
output.

## 4.7 Pattern A — correlation only, browser console

See ch. 3 §3.9 for the full browser console-wrapping example — same underlying
mechanism (`trace.getSpan(context.active())`), applied by wrapping `console.*`
methods instead of a Node logger's plugin points, since the browser console has no
equivalent of pino's `mixin`/winston's `format` extension seam.

## 4.8 Pattern B — Logs Bridge, with the official `instrumentation-pino` package

Rather than hand-writing the mixin from §4.5 _and_ separately standing up an OTel
Logs export pipeline, `@opentelemetry/instrumentation-pino` does both by patching
pino itself to also forward every log record into the OTel Logs SDK:

```ts
// instrumentation.ts — registered the same way as any Node auto-instrumentation (ch. 2 §2.1)
import { NodeSDK } from '@opentelemetry/sdk-node';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { logs } from '@opentelemetry/api-logs';

const loggerProvider = new LoggerProvider();
loggerProvider.addLogRecordProcessor(
  new BatchLogRecordProcessor(
    new OTLPLogExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }),
  ),
);
logs.setGlobalLoggerProvider(loggerProvider);

const sdk = new NodeSDK({
  instrumentations: [
    new PinoInstrumentation({
      logHook: (span, record) => {
        record['resource.service.name'] = 'checkout-service'; // optional enrichment hook
      },
    }),
  ],
});
sdk.start();
```

```ts
// application code — completely unchanged from §4.5, still calling plain pino
import pino from 'pino';
const logger = pino();
logger.info({ userId: '123' }, 'order created');
// now: (a) still writes to stdout exactly as before, AND
//      (b) is forwarded, with trace context attached automatically by the
//          instrumentation, into the OTel Logs pipeline configured above
```

**What you're trading for the automatic dual-delivery:** a second export pipeline
(its own `BatchLogRecordProcessor` tuning, ch. 5, its own exporter failure modes)
running for every log line, and dependence on `@opentelemetry/sdk-logs` +
`@opentelemetry/exporter-logs-otlp-http`, both explicitly flagged above (§4.1 Pattern
B) as younger/less battle-tested than the tracing SDK at the versions this repo pins.
Worth load-testing log volume through this path specifically before relying on it for
a high-log-volume service — a pipeline that's fine at moderate log rates can behave
differently at your actual production volume, and the newer Logs SDK has less field
experience absorbing that than `sdk-trace-node` does.

## 4.9 Pattern C — full replacement, direct OTel Logs API

```ts
import { logs, SeverityNumber } from '@opentelemetry/api-logs';

const otelLogger = logs.getLogger('checkout-service');

otelLogger.emit({
  severityNumber: SeverityNumber.INFO,
  severityText: 'INFO',
  body: 'order created',
  attributes: { userId: '123' },
  // trace context is attached automatically from the active span, same as Pattern A/B —
  // this is a property of the Logs SDK itself reading context.active(), not something
  // you pass in manually
});
```

No pino/winston involved at all — this is what "library/infra code with zero
logging-library dependency" (§4.1 Pattern C) looks like concretely. Notice the
`body`/`attributes`/`severityNumber` shape is close to, but not identical to, what
pino/winston call sites look like — this is the real migration cost flagged above:
existing `logger.info({ userId }, 'message')` call sites across a codebase don't map
1:1 syntactically to `otelLogger.emit({...})`, so adopting this pattern broadly is a
genuine rewrite of every call site, not a config change.

## 4.10 Severity mapping

OTel logs have a standardized severity model (`SeverityNumber` 1–24, mapped to
`TRACE`/`DEBUG`/`INFO`/`WARN`/`ERROR`/`FATAL` bands, each with 4 sub-levels) that
doesn't line up 1:1 with every logger's own level names. pino's numeric levels vs
OTel's `SeverityNumber` bands don't share the same scale, so a bridge/correlation
layer needs an explicit table rather than a formula:

| pino level | pino numeric value | OTel `SeverityNumber` | OTel band |
| ---------- | ------------------ | --------------------- | --------- |
| `trace`    | 10                 | 1 (`TRACE`)           | TRACE     |
| `debug`    | 20                 | 5 (`DEBUG`)           | DEBUG     |
| `info`     | 30                 | 9 (`INFO`)            | INFO      |
| `warn`     | 40                 | 13 (`WARN`)           | WARN      |
| `error`    | 50                 | 17 (`ERROR`)          | ERROR     |
| `fatal`    | 60                 | 21 (`FATAL`)          | FATAL     |

`@opentelemetry/instrumentation-pino` (Pattern B, §4.8) handles this mapping
internally — it's only something to hand-build if implementing Pattern A's
correlation manually with a logger that has no official OTel instrumentation
package, or if building custom severity-aware logic (e.g. §4.5's level-gated mixin
idea).

## 4.11 Edge cases and grey areas checklist

| #   | Scenario                                                                                                                   | What actually happens                                                                                                                                                                                                                                                                     | Reference         |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 1   | Log call happens with no active span (e.g. at process startup, before any request)                                         | `trace.getSpan(context.active())` returns `undefined` — correlation fields are simply omitted, not set to empty/null values; this is correct, fail-safe behavior, not a bug                                                                                                               | §4.4              |
| 2   | `winston.format` ordering has the trace-context format _after_ `json()`                                                    | Trace fields never make it into the serialized output — format chain order is load-bearing, not cosmetic                                                                                                                                                                                  | §4.6              |
| 3   | Pattern B (`instrumentation-pino`) enabled, but pino was already `require`'d before the SDK's `--require` preload finished | Same ordering hazard as ch. 2 §2.1/§2.8 — the patch may not apply; pino keeps working normally but without OTel forwarding, silently                                                                                                                                                      | ch. 2 §2.1        |
| 4   | High log-volume service on Pattern B                                                                                       | Both the original transport (e.g. stdout → log shipper) and the new `BatchLogRecordProcessor` pipeline carry full volume — doubled downstream load, and the newer Logs SDK's behavior under sustained high volume is less field-proven than tracing's                                     | §4.8              |
| 5   | Team wants "always keep logs for a trace that had an error," analogous to tail-based trace sampling                        | No equivalent standard mechanism for logs at the SDK level (ch. 1 §1.6) — this is a backend/Collector-side capability question, not something Pattern A/B configuration alone provides                                                                                                    | ch. 1 §1.6, §4.10 |
| 6   | Migrating an existing large codebase's log call sites from pino to Pattern C                                               | Not a mechanical find-replace — `logger.info({fields}, 'msg')` and `otelLogger.emit({body, attributes, severityNumber})` are different shapes; full replacement is a real per-call-site rewrite, which is exactly why Pattern C is scoped to greenfield/infra code, not general migration | §4.9              |
