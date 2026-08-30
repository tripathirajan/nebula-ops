# 2. OpenTelemetry for Node.js — tutorial and scenario reference

This chapter goes deep specifically because instrumentation is where most real-world
OTel setups quietly break: partially-instrumented libraries, spans that stop
appearing after a dependency bump, or a message-consumer loop where every message
ends up parented to the same span. Each section below has a runnable-shape example
and links to the official docs it's based on. Section 2.10 is a standalone checklist
of the edge cases/grey areas that don't fit neatly into "here's how X works."

**Official references used throughout this chapter:**

- Node getting-started guide: https://opentelemetry.io/docs/languages/js/getting-started/nodejs/
- Instrumentation concepts: https://opentelemetry.io/docs/languages/js/instrumentation/
- Exporters: https://opentelemetry.io/docs/languages/js/exporters/
- Context propagation: https://opentelemetry.io/docs/languages/js/propagation/
- Instrumentation registry (`opentelemetry-js-contrib`): https://github.com/open-telemetry/opentelemetry-js-contrib
- `auto-instrumentations-node` meta-package source: https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/metapackages/auto-instrumentations-node
- Semantic conventions (span/attribute naming): https://opentelemetry.io/docs/specs/semconv/
- ESM support status/limitations: https://github.com/open-telemetry/opentelemetry-js/blob/main/doc/esm-support.md
- `NodeSDK` API reference: https://open-telemetry.github.io/opentelemetry-js/classes/_opentelemetry_sdk_node.NodeSDK.html

---

## 2.1 Minimal bootstrap, annotated

The canonical Node entry point, per the official getting-started guide, is a
dedicated file required/imported **before** anything else in the process:

```ts
// instrumentation.ts — must run before any app code that imports http/express/pg/etc.
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'checkout-service' }),
  traceExporter: new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
```

```bash
# loaded ahead of the app entry point, not imported from within it
node --require ./instrumentation.js ./src/index.js
```

Why `--require` (or `node --import` for ESM loaders, §2.9) instead of importing
`instrumentation.ts` from the top of `index.ts`: Node evaluates `require`/`import`
statements top-to-bottom as it parses `index.ts` itself, so if `index.ts`'s first line
is `import './instrumentation'` followed later by `import express from 'express'`,
there's no guaranteed ordering between "did the instrumentation's patching finish
registering" and "did some _other_ transitively-imported module already load
`express` first." `--require` guarantees the instrumentation file's synchronous
top-level code (`sdk.start()`) completes fully before Node even begins loading the
app's own entry file. This is the single most common root cause of "auto-instrumentation
isn't producing spans for library X" bug reports upstream.

## 2.2 Auto-instrumentation: what actually happens when a library isn't in use

`getNodeAutoInstrumentations()` from `@opentelemetry/auto-instrumentations-node`
returns roughly 40+ `Instrumentation` instances — one per supported library (http,
express, fastify, koa, pg, mysql2, mongodb, redis, ioredis, grpc, graphql, aws-sdk,
kafkajs, amqplib, and more; full current list in the meta-package's `package.json`
`dependencies`, linked above). Each `Instrumentation.enable()` call registers a
`require`-hook for its specific target module name via
`@opentelemetry/instrumentation`'s `InstrumentationNodeModuleDefinition` — it does
**not** eagerly load or patch anything belonging to `redis` or `express` at that
point. The hook only fires — and only then does the actual monkey-patching happen —
**if and when** something in the process actually `require`s `'redis'` (or `'express'`,
etc.).

**Practical consequence — the case you asked about directly:** if your service never
uses Redis, `RedisInstrumentation`'s hook sits registered but silently inert for the
lifetime of the process. It never fires, produces zero spans, and costs effectively
nothing at runtime beyond:

- **Startup cost**: the meta-package still `require`s and constructs all ~40+
  `Instrumentation` classes at `getNodeAutoInstrumentations()` call time, regardless
  of which ones ever get used — this is a fixed, one-time cost proportional to the
  full instrumentation set, not to what your service actually uses. For most services
  this is low-single-digit milliseconds and irrelevant; it can matter for very
  latency-sensitive cold-start contexts (see §2.10's FaaS note).
- **Dependency weight**: `node_modules` carries instrumentation packages (and their
  own transitive deps) for libraries you don't use — extra install size and extra
  surface area for `npm audit` findings, even though none of that code's patching
  logic ever executes.

**What to do about it — disabling unused instrumentations explicitly:**

```ts
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const instrumentations = getNodeAutoInstrumentations({
  // disable instrumentations for libraries this service doesn't use
  '@opentelemetry/instrumentation-redis': { enabled: false },
  '@opentelemetry/instrumentation-graphql': { enabled: false },
  '@opentelemetry/instrumentation-aws-sdk': { enabled: false },
  // keep the ones it does, optionally tuning them
  '@opentelemetry/instrumentation-http': {
    ignoreIncomingPaths: ['/healthz', '/metrics'],
  },
});
```

Disabling unused ones is worth doing deliberately (not just "leave everything on
because it's harmless") for three reasons: it documents which infra the service
actually talks to, it trims the fixed startup cost above, and it removes a source of
false confidence — a service that has `RedisInstrumentation` "on" but never calls
Redis looks, to someone reading its dependency list, like it might be producing Redis
spans it isn't.

**Selecting instrumentations individually instead of the meta-package** is the other
option, useful when you want tight control over exactly what's installed:

```ts
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';

const instrumentations = [
  new HttpInstrumentation(),
  new ExpressInstrumentation(),
  new PgInstrumentation({ requireParentSpan: true }), // only trace DB calls that happen inside a traced request
];
```

This avoids the meta-package's "construct everything, disable what you don't want"
model in favor of "construct only what you want," at the cost of manually keeping the
list in sync as the service's dependencies change (adding a new DB driver means
remembering to add its instrumentation too — the meta-package would have already had
it registered, just inert).

## 2.3 Auto-instrumentation version compatibility — a real grey area

Every instrumentation package targets a specific **version range** of the library it
patches (declared in that instrumentation package's own `package.json` under a
`peerDependencies`-like compatibility check, enforced at runtime via version
sniffing, not npm's resolver). If your app's `pg`/`redis`/`express` version drifts
outside the range the installed instrumentation package supports:

- Most instrumentations **fail safe** — they detect the unsupported version at patch
  time and simply don't patch, logging a diagnostic message (visible if you set
  `@opentelemetry/api`'s diagnostic logger to `DiagLogLevel.DEBUG`) rather than
  throwing. The result looks identical to §2.2's "unused library" case from the
  outside — **zero spans, no error** — which makes it easy to mistake "our
  instrumentation silently stopped supporting our pg version after we upgraded it"
  for "we just don't use this."
- This is a maintenance surface with no compile-time signal: bumping `pg` in
  `package.json` doesn't fail CI if `@opentelemetry/instrumentation-pg` doesn't yet
  support the new major version — it just quietly stops producing spans. Worth
  checking the specific instrumentation package's supported-version range in
  `opentelemetry-js-contrib` (linked above) whenever bumping a major version of an
  instrumented library, and — as a detection backstop — worth spot-checking that
  expected spans are still appearing (e.g. via a smoke test using `otel-testing`'s
  in-memory exporter against a real call to the library) after such an upgrade,
  rather than assuming instrumentation coverage is permanent.

## 2.4 Custom (manual) instrumentation

Manual spans are for business logic auto-instrumentation can't know about — "this
specific multi-step operation matters to us as a unit," not "an HTTP call happened."

```ts
import { trace, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('checkout-service');

async function calculateOrderTotals(order: Order) {
  return tracer.startActiveSpan('checkout.calculate_totals', async (span) => {
    span.setAttribute('order.item_count', order.items.length);
    try {
      const totals = await computeTotals(order); // any nested instrumented calls
      // (e.g. a pg query in here) are
      // automatically parented to this span
      span.setAttribute('order.total_cents', totals.totalCents);
      span.setStatus({ code: SpanStatusCode.OK });
      return totals;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}
```

Key points from the official tracing API docs
(https://opentelemetry.io/docs/languages/js/instrumentation/#create-spans):

- `startActiveSpan` both creates the span **and** makes it the active span in context
  for the duration of the callback — any instrumented call (an HTTP client call, a DB
  query) made inside that callback automatically becomes a _child_ span, with no
  manual context wiring needed, because instrumentation reads `context.active()`
  itself (§1.5).
- `span.recordException` + `span.setStatus({ code: ERROR })` is the correct pairing
  for errors — `recordException` alone adds an event but does **not** mark the span's
  status as an error; a lot of hand-written instrumentation forgets `setStatus` and
  ends up with spans that have an exception event but still show green/OK in the
  trace UI.
- `span.end()` in a `finally` block is required — spans are not automatically ended;
  a code path that returns/throws without reaching `span.end()` leaks an unclosed
  span (it will simply never be exported, since export happens on span end, §5).

**Writing a genuinely custom `Instrumentation` class** (for a library with no
existing instrumentation package at all) is a heavier-weight, rarer case — subclass
`InstrumentationBase` from `@opentelemetry/instrumentation` and implement `init()` to
declare which module(s)/method(s) to patch, following the pattern used by every
package in `opentelemetry-js-contrib`. This is usually only worth doing for an
internal/proprietary client library your org maintains; for third-party libraries,
check `opentelemetry-js-contrib` first — reference:
https://github.com/open-telemetry/opentelemetry-js-contrib/blob/main/doc/instrumentation-guide.md

## 2.5 Inbound calls — HTTP server spans

`@opentelemetry/instrumentation-http` patches Node's built-in `http`/`https` modules
(and therefore anything built on them — Express, Fastify, Koa, etc. get HTTP-level
spans "for free" this way, with framework-specific instrumentations like
`instrumentation-express` layering _route-level_ detail — matched route pattern,
middleware timing — on top).

What happens automatically on an inbound request:

1. `HttpInstrumentation` intercepts the request before your handler runs.
2. It reads the incoming `traceparent`/`tracestate` headers via the configured
   **Propagator** (W3C Trace Context by default) and — if present — treats that as
   the **parent** SpanContext.
3. It creates a new span with `SpanKind.SERVER`, parented accordingly (or as a new
   root span if no valid incoming trace headers exist), with attributes like
   `http.request.method`, `url.path`, `http.response.status_code` per the semantic
   conventions.
4. The span becomes the active context for the duration of the request handler — this
   is _why_ a DB call made inside an Express route handler automatically nests under
   the request's server span without any manual linking.

**Grey area worth flagging:** if the incoming request has **no** `traceparent` header
at all (a request from a browser tab with no OTel instrumentation, an internal health
check, an unrelated system), the server span becomes a _new root span_ — this is
correct, expected behavior, not a bug — but it means "this trace looks incomplete/
starts oddly at service B with no upstream span" is diagnostic of a missing
propagation hop somewhere upstream (a proxy stripping headers, a client library that
isn't instrumented), not necessarily of anything wrong at service B itself.

## 2.6 Outbound calls — HTTP/DB/Redis client spans

### HTTP client

The same `HttpInstrumentation` that creates `SERVER` spans for inbound requests also
creates `SpanKind.CLIENT` spans for **outbound** `http.request`/`https.request` calls
(and therefore for most HTTP client libraries built on top, like `axios` and
node-fetch-based clients) — and, critically, it **injects** `traceparent`/`tracestate`
into the outgoing request's headers via the same Propagator, which is what makes the
downstream service's inbound `SERVER` span parent correctly. No manual header
plumbing needed for this to work end-to-end across two of your own OTel-instrumented
services.

### Database clients (pg, mysql2, mongodb, ...)

Each DB instrumentation package creates a `SpanKind.CLIENT` span per query/operation,
with semantic-convention attributes: `db.system` (`postgresql`, `mysql`, `mongodb`,
...), `db.name`, and (configurably — see below) `db.statement`.

```ts
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';

new PgInstrumentation({
  requireParentSpan: true, // don't create a span for queries with no active span
  // (e.g. a background connection-pool warmup query)
  enhancedDatabaseReporting: false, // when true, includes query *parameter values*,
  // not just the statement shape — a real PII/secret
  // exposure risk, off by default for exactly that reason
});
```

**`db.statement` and PII/secrets — a real, not hypothetical, grey area:**
`db.statement` by default captures the SQL text (parameterized form, e.g.
`SELECT * FROM users WHERE id = $1` — placeholders, not literal values, for most SQL
instrumentations). `enhancedDatabaseReporting: true` (available on some DB
instrumentations) goes further and includes actual bound parameter _values_ — which
can be customer PII, tokens, or anything else the query touched — and is off by
default specifically because of that risk. Confirm this stays off (or is paired with
an explicit scrubbing processor) before ever enabling it in a service handling
sensitive data.

### Redis / ioredis

```ts
import { RedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';

new RedisInstrumentation({
  dbStatementSerializer: (cmdName, cmdArgs) => `${cmdName} ${cmdArgs.length} args`,
  // default serializer includes command args verbatim — same PII concern as above,
  // e.g. `SET session:<token> <value>` would otherwise appear as literal span data
});
```

Redis-specific nuance beyond the generic DB-client pattern: `db.statement` for Redis
is the command name + arguments (e.g. `GET user:1234`), and **arguments are included
by default** unless you supply a `dbStatementSerializer` — worth checking explicitly,
since Redis is commonly used for session tokens/cache keys that can themselves be
sensitive, not just for non-sensitive cache data.

**Redis as a message bus (pub/sub) is a distinct, unsolved case:** the DB-client
instrumentation above covers Redis used as a key-value store (`GET`/`SET`/etc.) —
each command is a request/response pair naturally scoped to whatever span was active
when it was called, same as any other DB client. Redis **pub/sub** (`PUBLISH`/
`SUBSCRIBE`) is structurally different — a publisher and subscriber are different
processes with no request/response relationship for OTel to hook a `CLIENT`/`SERVER`
span pair onto, and there is **no standard, widely-adopted auto-instrumentation that
propagates trace context across a Redis pub/sub message** the way Kafka/AMQP
instrumentation does (§2.7). If Redis pub/sub is used as an inter-service message bus
and end-to-end trace continuity across that hop matters, that's a custom
instrumentation problem: manually serialize the current `SpanContext` into the
published message payload and manually extract + start a linked/parented span on the
subscriber side.

### Other infra — AWS SDK, gRPC, GraphQL

- `@opentelemetry/instrumentation-aws-sdk` instruments every AWS SDK v3 client call
  (S3, DynamoDB, SQS, SNS, ...) as a `CLIENT` span with `rpc.system: "aws-api"` plus
  service-specific attributes — one instrumentation package covers all AWS services
  used via the SDK, not one per service.
- `@opentelemetry/instrumentation-grpc` covers both gRPC client (`CLIENT` span) and
  server (`SERVER` span) sides, with context propagation over gRPC metadata (the gRPC
  equivalent of HTTP headers) handled automatically, same pattern as §2.5's HTTP case.
- `@opentelemetry/instrumentation-graphql` adds spans _within_ GraphQL execution
  (per-resolver spans), layered on top of whatever HTTP/Express spans already wrap
  the GraphQL endpoint itself — it doesn't replace the HTTP-level span, it adds detail
  inside it.

## 2.7 Inbound/outbound for message queues — the pattern that breaks naive assumptions

Message-queue instrumentation (`@opentelemetry/instrumentation-kafkajs`,
`@opentelemetry/instrumentation-amqplib` for RabbitMQ, and similar) uses
`SpanKind.PRODUCER` on the sending side and `SpanKind.CONSUMER` on the receiving
side — not `CLIENT`/`SERVER`, per the semantic conventions for messaging systems
(https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/), because a
producer/consumer relationship is asynchronous and often many-to-many, unlike a
synchronous request/response call.

**Producer side:** the instrumentation injects `traceparent` into the outgoing
message's **headers/properties** (Kafka message headers, AMQP message properties) —
the message-queue equivalent of HTTP header injection (§2.6). This is what lets a
consumer, potentially minutes later and in a completely different process, correctly
parent (or, more precisely, **link** — see below) its consumer span back to the
producing trace.

**Consumer side — the part that genuinely differs from HTTP and is worth being
deliberate about:**

- A single consumer process typically processes **many** messages over its lifetime,
  often in a tight loop (`for await (const message of consumer)`), not "one request
  in, handle it, done" the way an HTTP server handles one request per invocation of
  its handler. If message-handling code doesn't explicitly scope each message to its
  own context, spans/logs from processing message #2 can end up nested under or
  correlated with message #1's still-open span, simply because nothing told the
  runtime the previous message's "active span" should no longer be active.
- The semantic-conventions guidance (and what correctly-implemented consumer
  instrumentation does) is to use `context.with()` explicitly per message:

  ```ts
  import { context, trace } from '@opentelemetry/api';

  for await (const message of consumer) {
    const parentContext = extractContextFromMessageHeaders(message.headers); // propagator.extract(...)
    await context.with(parentContext, async () => {
      const span = tracer.startSpan('process order.created', { kind: SpanKind.CONSUMER });
      await context.with(trace.setSpan(context.active(), span), async () => {
        await handleMessage(message); // anything traced in here nests correctly under *this* message's span
      });
      span.end();
    });
  }
  ```

  Well-maintained instrumentation packages (kafkajs, amqplib) do this internally
  already for the auto-instrumented case — the point of writing it out here is that
  **hand-rolled consumer loops, or less-common message-queue clients without an
  existing instrumentation package, need this same discipline applied manually**, and
  it's easy to get wrong by assuming context "just works" the way it does for HTTP.

- **Batch consumption** (many message-queue clients support pulling a batch of N
  messages and handing them to your code at once, e.g. Kafka's batch consumer mode)
  makes this sharper still: there is no single "the" trace for a batch of unrelated
  messages from different producers/traces. The semantic-conventions-correct approach
  is typically to create one span per message using **Links** (§1.2) rather than
  trying to force a single parent — a batch-processing span links to each message's
  originating trace context rather than being a child of any single one of them.

## 2.8 Long-lived connections created before the SDK starts

A subtler variant of §2.1's ordering problem: if a database connection pool, Redis
client, or similar long-lived connection object is constructed at module-load time —
common in patterns like `export const pool = new Pool(...)` at the top of a
`db.ts` module — and that module happens to be imported (even transitively) before
`instrumentation.ts`'s `sdk.start()` finishes registering hooks, the **connection
object itself** may have already captured unpatched references to whatever internal
methods the instrumentation would have wrapped. Some instrumentation packages patch at
the prototype level (safe regardless of when instances were constructed); some patch
per-instance or capture module-level function references at require time (not safe).
This is exactly why `--require`-based preloading (§2.1) is the documented pattern
rather than "just import the SDK setup early in your own entry file" — the latter
still leaves a window where module-load-time side effects in other files can race
against it depending on your module graph's actual import order, which is often not
obvious from reading the entry file alone.

## 2.9 ESM — a genuinely different mechanism, not just a syntax change

Everything in §2.1–§2.8 assumes CommonJS (`require`), which is what
`@opentelemetry/instrumentation`'s hook mechanism was originally built around: it
works by intercepting `Module.prototype.require`. **ES Modules don't go through that
same path** — `import` bindings are resolved and effectively immutable by the module
system in a way plain `require`-hook monkey-patching cannot intercept after the fact.

For ESM apps, Node instrumentation requires an explicit **loader hook**, registered
via `--experimental-loader` (older Node) or `--import` (newer Node) pointing at
`@opentelemetry/instrumentation/hook.mjs`, in addition to (not instead of) the normal
`--require ./instrumentation.js` for the SDK setup itself:

```bash
node \
  --import ./instrumentation.js \
  --experimental-loader=@opentelemetry/instrumentation/hook.mjs \
  ./src/index.mjs
```

This is an active, evolving area of the JS SDK (see the linked `esm-support.md`
doc for current per-instrumentation ESM support status) — **not every
instrumentation package in `opentelemetry-js-contrib` is guaranteed to work
correctly under ESM at any given time**, and this should be verified per
instrumentation actually in use, not assumed. Worth flagging explicitly as an
implementation-time check for `otel-node`, given the package targets are TypeScript
services that may compile to either CJS or ESM depending on the consuming app's own
`tsconfig`/`package.json` `type` field.

## 2.10 Edge cases and grey areas checklist

A running list — extend during implementation as new ones surface, rather than
treating this as exhaustive on day one:

| #   | Scenario                                                                                                                             | What actually happens                                                                                                                                                                                                                        | Reference                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 1   | A library is a declared dependency but never actually called at runtime (e.g. `redis` installed for a rarely-used feature flag path) | Instrumentation hook registered, never fires, zero spans, zero runtime cost beyond fixed startup (§2.2)                                                                                                                                      | §2.2                        |
| 2   | A library's version is bumped past what its instrumentation package supports                                                         | Instrumentation silently stops patching — no spans, no error, indistinguishable from case #1 from the outside                                                                                                                                | §2.3                        |
| 3   | Manual span created but `span.end()` never called on some code path                                                                  | Span never exports (export happens at span end); silently missing from traces, not an error                                                                                                                                                  | §2.4                        |
| 4   | `recordException` called without `setStatus({code: ERROR})`                                                                          | Span shows an exception event but overall status remains unset/OK — misleading in trace UIs that filter/color by status                                                                                                                      | §2.4                        |
| 5   | Incoming HTTP request has no `traceparent` header                                                                                    | New root span created — correct behavior, but reads as "trace starts abruptly here" and can look like a missing upstream hop when it's actually just an uninstrumented caller                                                                | §2.5                        |
| 6   | `enhancedDatabaseReporting`/Redis arg serialization left at defaults on a service touching sensitive data                            | Query parameter values / Redis command arguments captured verbatim in span attributes — real PII/secret exposure risk                                                                                                                        | §2.6                        |
| 7   | Redis used as a pub/sub bus, trace continuity expected across publish→subscribe                                                      | No standard auto-instrumentation propagates context over Redis pub/sub — appears as two disconnected traces unless manually bridged                                                                                                          | §2.6                        |
| 8   | Consumer loop processes many queue messages without explicit per-message `context.with()`                                            | Spans/log-context can bleed across messages if hand-rolled without following the instrumentation-internal pattern                                                                                                                            | §2.7                        |
| 9   | Batch message consumption (many messages, multiple origin traces, one handler invocation)                                            | No single correct "parent" — Links, not parenting, is the semantically correct approach                                                                                                                                                      | §2.7                        |
| 10  | A DB pool/Redis client constructed at module load time, before SDK preload finishes                                                  | May capture unpatched method references depending on how that specific instrumentation patches (prototype vs per-instance)                                                                                                                   | §2.8                        |
| 11  | App ships as ESM (`"type": "module"`)                                                                                                | Standard `--require` CJS hook doesn't intercept `import` — needs the separate loader-hook flag, and per-instrumentation ESM support isn't universal                                                                                          | §2.9                        |
| 12  | Same call manually wrapped in a custom span _and_ covered by an enabled auto-instrumentation                                         | Two spans for the same operation (usually nested: auto-instrumentation's span becomes a child of the manual one, or vice versa depending on call order) — not wrong, but worth being intentional about rather than accidental double-tracing |                             |
| 13  | Very short-lived process (CLI tool, some FaaS invocations) where SDK startup cost (§2.2) is a meaningful fraction of total runtime   | Fixed instrumentation-construction cost that's noise for a long-lived server becomes proportionally significant; worth trimming the instrumentation set (§2.2's selective-enable pattern) rather than using the full meta-package default    | §2.2, §5.6 (Phase-1 primer) |
