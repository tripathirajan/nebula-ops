# 4. OpenTelemetry as a transport for existing logger libraries

## 4.1 The core question

Teams almost always already have a logger (pino, winston, bunyan, or `console` in the
browser) with established call sites (`logger.info(...)`) throughout the codebase.
Adopting OTel for logs does **not** mean ripping that out. The question is how OTel
*relates* to that existing logger — there are three distinct patterns, with different
trade-offs:

### Pattern A — Correlation only (no OTel Logs pipeline at all)

The existing logger keeps writing exactly as before, to exactly the same destination
(stdout, a file, a browser console) it always did. The *only* change is: every log
line gets `trace_id`/`span_id` fields injected, sourced from whatever span is active
at the moment the log call happens. No `LoggerProvider`, no `LogRecordExporter`, no
OTel Logs SDK involved at all — this is pure "read the active span's context and
stick it into the log's structured fields."

- **pino**: done via the `mixin` option — a function pino calls on every log line to
  merge extra fields in, cheap to implement, no pino internals touched.
- **winston**: done via a custom `format` in the format chain (`winston.format.combine(...)`),
  same idea.
- **browser console**: done by wrapping `console.log`/`warn`/`error` to append
  trace/span id to the logged output or as extra structured args.

This is by far the lowest-cost, lowest-risk pattern, and the one most teams want
first: your existing log pipeline (whatever ships logs to Datadog/Splunk/ELK/etc.
today) keeps working unchanged, but now every log line is queryable/joinable by trace
ID in your trace backend too ("show me every log emitted during this slow request").

### Pattern B — Logs Bridge API (dual pipeline)

The existing logger still exists and still writes to its normal destination, **but**
an appender/transport is added that *also* forwards each log record into the OTel
Logs pipeline (`LoggerProvider` → `LogRecordProcessor` → `LogRecordExporter` →
your OTel backend), in addition to (not instead of) the original output. This is
what "Logs Bridge API" formally refers to in the OTel spec — most languages'
implementations of it are less mature than the tracing/metrics SDKs (true of the JS
SDK at the versions pinned in this repo: `@opentelemetry/sdk-logs` and the
appender packages for pino/winston are usable but younger/less battle-tested than
`sdk-trace-node`).

Trade-off vs Pattern A: you get a genuinely unified OTel Logs signal (in the same
backend as traces/metrics, queryable the same way, correlated automatically via the
Logs SDK's own context-reading), at the cost of a second export pipeline (own
batching, own exporter config, own failure modes) running alongside whatever the
existing logger already does.

### Pattern C — Full replacement (OTel Logs API is the only logger)

Application code calls the OTel Logs API directly (`logger.emit({...})`) instead of
pino/winston/console. Rare for teams with an established logger — mostly relevant for
new services with no legacy logging investment, or for library/infra code that wants
zero dependency on a specific logging library. Highest OTel-native consistency,
highest migration cost, most exposure to the Logs SDK's relative immaturity.

## 4.2 Which pattern fits which situation

| Situation | Likely fit |
|---|---|
| Established service, existing pino/winston pipeline already shipping logs somewhere that works | **A** — add correlation, change nothing else, near-zero risk |
| Team wants trace/log correlation *and* a single OTel-native backend for both, willing to run/tune a second export path | **B** |
| Greenfield service, or infra code with no existing logger dependency | **C**, or A if there's still a preferred existing logger for humans reading raw output |
| Browser | Almost always **A** (console bridge) — a full OTel Logs pipeline from the browser adds another public-reachable exporter endpoint and payload-size cost (§3.5) for a signal that's usually lower-value client-side than traces/vitals |

## 4.3 Why correlation is the part that actually matters most

The single highest-value outcome of "OTel + logging" for most teams isn't moving log
*storage* to OTel — it's making trace ID a **join key** between two systems that
otherwise have no relationship: "this request was slow (seen in the trace backend) —
what did the application actually log while handling it (seen in the log backend)?"
That join only requires Pattern A's `trace_id`/`span_id` field injection to exist.
Everything past that (full bridge, full replacement) is about *where logs live and
how they're queried*, not about correlation, which is why Pattern A is usually the
right default and B/C are opt-in upgrades for teams who specifically want a unified
backend.

## 4.4 What the SDK context read looks like, precisely

All three patterns rely on the same underlying primitive: reading the currently
active span from the OTel `context` API at the moment the log call happens
(`trace.getSpan(context.active())`), then reading that span's `traceId`, `spanId`,
and `traceFlags` off its `SpanContext`. This is why correlation is only as reliable
as context propagation itself (§1.5, §2.3, §3.3) — a log line emitted from code the
active `ContextManager` lost track of (e.g. inside browser code untouched by
`ZoneContextManager`/`StackContextManager`, or an unusual Node async pattern) will
correlate to no span, not the wrong one; it fails safe/empty rather than silently wrong.

## 4.5 Severity mapping

OTel logs have a standardized severity model (`SeverityNumber` 1–24, mapped to
`TRACE`/`DEBUG`/`INFO`/`WARN`/`ERROR`/`FATAL` bands, each with 4 sub-levels) that
doesn't line up 1:1 with every logger's own level names (pino: `trace, debug, info,
warn, error, fatal` — a fairly direct fit; some loggers use numeric levels with
different semantics). A correlation/bridge layer needs an explicit mapping table
rather than assuming names match; this is typically a small, boring lookup, but
worth designing deliberately rather than default-guessing per logger.
