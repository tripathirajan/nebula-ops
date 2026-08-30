# 3. OpenTelemetry for the browser — tutorial and scenario reference

Same treatment as chapter 2: runnable-shape examples, official references per
section, and a dedicated edge-case checklist. Read §3.1's "why this is a genuinely
different problem than Node" first if you haven't — the rest of this chapter assumes
it. This chapter covers plain (framework-agnostic) browser usage; if you're building
a React app specifically, read this chapter first and then
[`09-otel-web-in-react.md`](09-otel-web-in-react.md) for the React-specific
integration patterns and gotchas (StrictMode, concurrent rendering, SSR/hydration)
layered on top of everything here.

**Official references used throughout this chapter:**

- Browser getting-started guide: https://opentelemetry.io/docs/languages/js/getting-started/browser/
- Instrumentation concepts: https://opentelemetry.io/docs/languages/js/instrumentation/
- Context propagation (W3C Trace Context): https://opentelemetry.io/docs/languages/js/propagation/
- `sdk-trace-web` source/README: https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/opentelemetry-sdk-trace-web
- Web instrumentation packages (fetch/XHR/document-load/user-interaction): https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages
- `zone.js`: https://github.com/angular/angular/tree/main/packages/zone.js
- `web-vitals`: https://github.com/GoogleChrome/web-vitals
- W3C Trace Context spec (the `traceparent`/`tracestate` header format): https://www.w3.org/TR/trace-context/
- `navigator.sendBeacon` MDN reference: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon

---

## 3.1 Why this is a genuinely different problem than Node (recap + why it matters for what follows)

Node's story (ch. 2) rests on three things the browser doesn't have: a module cache
to monkey-patch (`require`), a built-in async-local-storage primitive
(`AsyncLocalStorage`), and a same-network-trust relationship with its export target.
Every section below exists because of one of those three gaps — keep them in mind as
you read, since they explain _why_ the browser API looks the way it does, not just
_what_ it does.

## 3.2 Minimal bootstrap, annotated

```ts
// tracing.ts — imported once, as early as possible in your app's entry point
// (there is no --require preload equivalent for the browser; "early" here means
// "before any instrumented API — fetch, XHR — is actually called", not before
// module evaluation, since there's no require-hook race to win, only a call-time one)
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const provider = new WebTracerProvider({
  resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'checkout-web' }),
  spanProcessors: [
    new BatchSpanProcessor(
      new OTLPTraceExporter({ url: 'https://otel.internal.example.com/v1/traces' }),
    ),
  ],
});

provider.register({
  contextManager: new ZoneContextManager(), // see §3.4 for the Zone-vs-Stack decision
});

registerInstrumentations({
  instrumentations: [
    new FetchInstrumentation({
      propagateTraceHeaderCorsUrls: [/^https:\/\/api\.internal\.example\.com/], // §3.5
    }),
    new XMLHttpRequestInstrumentation({
      propagateTraceHeaderCorsUrls: [/^https:\/\/api\.internal\.example\.com/],
    }),
    new DocumentLoadInstrumentation(),
  ],
});
```

Note the structural difference from Node's bootstrap (§2.1 of ch. 2): there's no
single `NodeSDK`-equivalent convenience class in wide use — `WebTracerProvider`,
`registerInstrumentations`, and the `ContextManager` are wired up individually. This
is a large part of _why_ a wrapper package (`otel-web`) earns its keep here more than
almost anywhere else in this project — see [`08-why-this-layer.md`](08-why-this-layer.md).

## 3.3 Auto-instrumentation for unused browser APIs — same question as ch. 2, different mechanism

Chapter 2, §2.2 asked: what happens if a service never uses Redis? The browser
equivalent: what happens if a page never makes an XHR call (say, it's fetch-only), or
never triggers `DocumentLoadInstrumentation`'s events?

The mechanism is different from Node's lazy require-hook, and it matters:

- **`FetchInstrumentation`/`XMLHttpRequestInstrumentation` patch a _global_
  (`window.fetch`, `XMLHttpRequest.prototype.open`/`send`) immediately and
  unconditionally at `registerInstrumentations()` time** — unlike Node's
  require-hook, there's no "only patches if the module gets loaded" laziness,
  because there's no module-loading event to hook in the browser; `fetch` already
  exists as a global the moment the page loads. So enabling `XMLHttpRequestInstrumentation`
  on a fetch-only page costs a wrapped-but-never-invoked prototype method — negligible
  runtime cost (the wrapper function exists but the original code path a page's own
  `fetch`-only code takes never touches `XMLHttpRequest` at all), but it _is_ extra
  JS shipped to the browser bundle (§3.3 bundle-size note below), which is a cost
  Node's server-side "extra dependency weight" analog doesn't share the same severity
  of — browser bundle size directly costs the end user download time/parse time on
  every page load, not just your own process's startup.
- **`DocumentLoadInstrumentation` subscribes to `PerformanceObserver`/`window.onload`
  events that fire exactly once per page load** — if the page is a long-lived SPA
  that never fully reloads after initial load (client-side routing only), this
  instrumentation produces exactly one span tree total, at initial load, and then
  never again — not a bug, just worth knowing so "why did document-load spans stop
  after the first page" isn't mistaken for a broken instrumentation.

**Trimming what you don't need:**

```ts
// A fetch-only SPA with client-side routing (no full page reloads after first load)
registerInstrumentations({
  instrumentations: [
    new FetchInstrumentation({
      propagateTraceHeaderCorsUrls: [/^https:\/\/api\.internal\.example\.com/],
    }),
    // XMLHttpRequestInstrumentation omitted — this app only uses fetch
    new DocumentLoadInstrumentation(), // still worth keeping — one-time initial-load spans are usually valuable
  ],
});
```

Unlike Node's meta-package (`getNodeAutoInstrumentations()` with 40+ libraries and a
per-instrumentation `{ enabled: false }` toggle), there is no browser meta-package —
you import and register only the instrumentation classes you want, so "not using it"
in the browser world defaults to "not importing it," not "imported but disabled."
This is generally a cleaner default than Node's, precisely _because_ bundle size is a
real, user-facing cost here in a way Node's server-side dependency footprint isn't.

## 3.4 Context propagation: Zone vs Stack, with actual code and actual failure cases

### Zone-based (`ZoneContextManager`)

```ts
import { ZoneContextManager } from '@opentelemetry/context-zone';
provider.register({ contextManager: new ZoneContextManager() });
```

Requires `zone.js` (pulled in transitively by `@opentelemetry/context-zone`) to be
loaded, which patches `setTimeout`, `Promise`, `addEventListener`, and other async
browser primitives globally. Once installed, context correctly follows _any_ async
code path through those patched primitives — including plain application code the
SDK never explicitly wrapped, which is the main advantage over Stack (§ below).

**Concrete failure mode this avoids:**

```ts
async function loadDashboard() {
  const span = tracer.startSpan('dashboard.load');
  await context.with(trace.setSpan(context.active(), span), async () => {
    setTimeout(() => {
      // With ZoneContextManager: context.active() here still correctly resolves
      // to `span`'s context, because zone.js tracked this setTimeout callback as
      // belonging to the zone that was active when setTimeout was called.
      const child = tracer.startSpan('dashboard.render_widgets'); // correctly parented
      child.end();
    }, 0);
  });
  span.end();
}
```

**Concrete Angular conflict this creates:** Angular's own change-detection system
also depends on zone.js (a specific, sometimes different, version/instance of it) to
detect when to re-render. Two independent consumers of global zone.js patching in the
same page is a known source of subtle bugs — change detection firing at unexpected
times, or OTel context resolving incorrectly — if the versions/instances aren't
carefully aligned. This isn't hypothetical; it's flagged directly in OTel's own web
SDK documentation as a reason some Angular teams choose `StackContextManager`
instead, despite the coverage trade-off below.

### Stack-based (`StackContextManager`)

```ts
import { StackContextManager } from '@opentelemetry/sdk-trace-web'; // no separate zone.js dependency
provider.register({ contextManager: new StackContextManager() });
```

No extra dependency, no global monkey-patching beyond what the instrumentation
packages themselves already do (fetch/XHR wrapping). Tracks context via a manual
push/pop stack maintained around instrumented call sites.

**Concrete failure mode this has (that Zone doesn't):**

```ts
async function loadDashboard() {
  const span = tracer.startSpan('dashboard.load');
  await context.with(trace.setSpan(context.active(), span), async () => {
    setTimeout(() => {
      // With StackContextManager: this setTimeout callback is PLAIN application
      // code, not something instrumentation wrapped — StackContextManager has no
      // hook into raw setTimeout, so context.active() here returns the ROOT context,
      // not `span`'s. This child span becomes an unparented root span instead of a
      // child of dashboard.load.
      const child = tracer.startSpan('dashboard.render_widgets'); // NOT correctly parented
      child.end();
    }, 0);
  });
  span.end();
}
```

The fix under `StackContextManager` is to re-enter context explicitly at the async
boundary application code controls:

```ts
setTimeout(
  context.bind(context.active(), () => {
    const child = tracer.startSpan('dashboard.render_widgets'); // correctly parented now
    child.end();
  }),
  0,
);
```

`context.bind(ctx, fn)` is the general-purpose escape hatch for exactly this gap —
it's cheap to apply once you know a given call site needs it, but StackContextManager
gives you **no signal** that a call site needed it; the span is just silently
unparented. This is the practical shape of the trade-off from
[`08-why-this-layer.md`](08-why-this-layer.md) §8.6 open question #1: Zone costs a
global-patching dependency and an Angular interaction risk; Stack costs silent gaps
in exactly the application code the SDK can't see into, discoverable only by noticing
spans that should be nested showing up as separate root traces instead.

## 3.5 CORS trace-header propagation — code and the failure it prevents

```ts
new FetchInstrumentation({
  // Only these origins receive `traceparent`/`tracestate` on outgoing requests.
  // Everything else (including same-origin-looking third-party calls) does not.
  propagateTraceHeaderCorsUrls: [
    /^https:\/\/api\.internal\.example\.com/,
    'https://checkout-api.example.com',
  ],
});
```

**What happens if you allow-list an origin that doesn't expect the headers:** the
browser sends a CORS preflight `OPTIONS` request (because `traceparent` is a
non-simple header) before the real request. If that origin's server doesn't respond
with `Access-Control-Allow-Headers: traceparent, tracestate` (or a matching wildcard),
the browser **blocks the actual request entirely** — not "sends it without the
header," but a hard CORS failure, breaking the feature the request was for. This is
the concrete, production-breaking version of the general CORS point in the earlier
overview — worth testing explicitly (a preflight check against the target origin,
not just "does the trace show up") before adding any new origin to this list.

**What happens if you _don't_ allow-list an origin that's actually yours:** the
request still works completely normally (no header is added, so no CORS-header
consideration is triggered at all) — it just doesn't carry trace context, so the
downstream service's inbound span becomes an unlinked root span instead of a child.
Silent, not broken — the same "looks like a missing upstream hop" signature as
Node's §2.5 missing-`traceparent` case, with the same likely cause here: a forgotten
allow-list entry.

## 3.6 Inbound vs outbound in the browser — there is no browser-side "inbound"

Worth stating explicitly since it's a natural question carried over from ch. 2: the
browser has no `SpanKind.SERVER` role in normal use — a browser page doesn't receive
inbound instrumented requests the way a Node service does (it _is_ the client for
every network call it makes: `fetch`/`XHR` to your APIs, third-party scripts, etc.).
The closest browser analog to "inbound" is **document load itself** — the page being
navigated to — which `DocumentLoadInstrumentation` captures as its own span tree
(navigation timing, resource timing) rather than as a `SERVER` span, because there's
no request _handler_ on the browser side to instrument; the browser is the recipient
of a document, not a request-processing server.

**Outbound** is the entire surface: every `fetch`/`XHR` call gets a `SpanKind.CLIENT`
span (mirroring Node's outbound HTTP client spans, §2.6 of ch. 2), with the same
header-injection mechanism, gated by the CORS allow-list above.

## 3.7 web-vitals bridge — concrete example

```ts
import { onCLS, onLCP, onINP, onFCP, onTTFB, type Metric } from 'web-vitals';
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('checkout-web');

function reportAsSpanEvent(metric: Metric) {
  const span = tracer.startSpan(`web-vitals.${metric.name.toLowerCase()}`);
  span.setAttribute('web_vitals.value', metric.value);
  span.setAttribute('web_vitals.rating', metric.rating); // 'good' | 'needs-improvement' | 'poor'
  span.setAttribute('web_vitals.navigation_type', metric.navigationType);
  span.end(); // zero-duration span used purely as a timestamped, attributed record
}

onCLS(reportAsSpanEvent);
onLCP(reportAsSpanEvent);
onINP(reportAsSpanEvent);
onFCP(reportAsSpanEvent);
onTTFB(reportAsSpanEvent);
```

**Grey area worth knowing:** `web-vitals` callbacks can fire **after** the page is
being unloaded (CLS and INP in particular are often finalized on `visibilitychange`
right as the user navigates away) — this intersects directly with §3.8's
`sendBeacon` discussion below, since a normal `BatchSpanProcessor` flush timer
(§5 of the primer) may not get a chance to run before the page is gone. Some
`web-vitals` callback registrations accept a `reportAllChanges`/flush-on-hidden
option; check the current `web-vitals` API docs (linked above) rather than assuming
a single call to `onCLS` alone guarantees delivery before unload.

## 3.8 Reliable export on page unload

```ts
// Without this: a BatchSpanProcessor's pending queue can simply vanish if the tab
// closes/navigates away before the next scheduled flush interval (§5 of the primer).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    void provider.forceFlush(); // best-effort; see note below on sendBeacon
  }
});
```

`provider.forceFlush()` still goes through the configured exporter's normal
transport (`fetch`/`XHR` for `OTLPTraceExporter` by default) — which itself can be
cancelled mid-flight by the browser during unload. For genuinely reliable
last-gasp delivery, the exporter needs to use `navigator.sendBeacon` specifically
(some OTLP HTTP exporter configurations/versions support a beacon-based transport
mode; check the specific exporter package version in use, since this isn't
universal across all OTLP HTTP exporter implementations) — `forceFlush` alone
reduces the _window_ for data loss but doesn't eliminate it the way a true
beacon-based transport does, per the MDN reference above on why `sendBeacon` exists
specifically for this use case.

## 3.9 Console bridge — concrete example

```ts
import { trace, context } from '@opentelemetry/api';

type ConsoleLevel = 'log' | 'warn' | 'error' | 'info' | 'debug';

function installConsoleBridge(levels: ConsoleLevel[] = ['warn', 'error']) {
  const original: Partial<Record<ConsoleLevel, (...args: unknown[]) => void>> = {};

  for (const level of levels) {
    original[level] = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      const span = trace.getSpan(context.active());
      const spanCtx = span?.spanContext();
      if (spanCtx) {
        original[level]!(...args, { trace_id: spanCtx.traceId, span_id: spanCtx.spanId });
      } else {
        original[level]!(...args); // no active span — logged unchanged, not an error (§4.4 of the primer)
      }
    };
  }

  return () => {
    for (const level of levels) {
      if (original[level]) console[level] = original[level]!;
    }
  };
}
```

This is Pattern A from the primer's logging chapter (correlation-only, §4.1) applied
to the browser console specifically — no OTel Logs pipeline involved, just tagging
existing `console.*` output with trace context so it's joinable against a trace
backend later (e.g. via a browser dev tools extension or a log-shipping pipeline that
already captures console output).

## 3.10 Exporter transport, security posture, and payload budget

Three properties of browser export worth being deliberate about, since they don't
have a server-side analog in the same way:

- **OTLP/HTTP only, in practice** — no gRPC from browser JS (no HTTP/2 trailers
  access, no raw TCP available to page scripts). Payloads are protobuf or JSON over
  `fetch`/`XHR`/`sendBeacon`. This is a hard platform constraint, not a
  configuration choice — don't reach for `@opentelemetry/exporter-trace-otlp-grpc`
  in browser code; it depends on Node's `http2`/`net` modules and will not run in a
  browser bundle.
- **The exporter endpoint is public-reachable by construction** — it's a URL the
  browser calls directly, unlike a Node service's Collector endpoint which usually
  sits inside a private network reachable only from other internal services. This
  means the browser-facing OTLP endpoint needs to be something safe to expose to
  _any_ user of the app: rate-limited (a malicious or buggy client shouldn't be able
  to flood it), unable to submit telemetry that corrupts or spoofs other tenants'
  data, and built with no assumption of network-level trust the way an internal
  Collector endpoint might have. This is a materially different security posture
  than the Node side (ch. 2), and worth a deliberate decision (e.g. a dedicated
  public-facing Collector endpoint/ingest gateway, separate from the one internal
  services export to) rather than pointing browser exporters at the same endpoint
  Node services use internally.
- **Payload size / request volume budget matters more here than server-side** —
  every span/log a browser exports is real bytes over the end user's (possibly slow,
  possibly metered) connection, competing with the actual application's own network
  usage. This is a materially bigger practical argument for aggressive sampling
  (ch. 6 §6.2) and batching (ch. 5) on the web side than on the Node side, where
  bandwidth between a service and its Collector is comparatively free.

## 3.11 Edge cases and grey areas checklist

| #   | Scenario                                                                                               | What actually happens                                                                                                                                                                                                                                                                              | Reference       |
| --- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | Page only uses `fetch`, never `XMLHttpRequest`                                                         | `XMLHttpRequestInstrumentation`, if still registered, wraps a prototype method that's never called — near-zero runtime cost, but unlike Node, still shipped in the bundle unless explicitly omitted                                                                                                | §3.3            |
| 2   | SPA with client-side routing, no full page reloads after initial load                                  | `DocumentLoadInstrumentation` produces exactly one span tree, at the very first load, then never again — expected, not broken                                                                                                                                                                      | §3.3            |
| 3   | `setTimeout`/raw async code inside `StackContextManager` setup                                         | Silently loses parent context — child spans become unparented roots with no warning                                                                                                                                                                                                                | §3.4            |
| 4   | Angular app using `ZoneContextManager`                                                                 | Possible zone.js version/instance conflict with Angular's own change-detection zone usage                                                                                                                                                                                                          | §3.4            |
| 5   | New allow-listed CORS origin doesn't return `Access-Control-Allow-Headers: traceparent`                | The **entire request is blocked** by the browser, not just un-traced — a functional break, not a telemetry gap                                                                                                                                                                                     | §3.5            |
| 6   | Own API origin forgotten from `propagateTraceHeaderCorsUrls`                                           | Request works fine, just isn't traced — downstream span appears as an unlinked root, same signature as a missing upstream hop                                                                                                                                                                      | §3.5            |
| 7   | CLS/INP web-vitals callback fires during page unload                                                   | Race against both the metric callback's own timing and the exporter's ability to flush before the tab closes                                                                                                                                                                                       | §3.7, §3.8      |
| 8   | `BatchSpanProcessor`'s scheduled flush hasn't fired yet when the tab closes                            | Buffered spans can be lost entirely unless an explicit `visibilitychange`/beacon-based flush is wired up                                                                                                                                                                                           | §3.8            |
| 9   | Ad blockers / privacy extensions present in the user's browser                                         | Can block the OTLP exporter's outgoing requests (matched as "tracking" traffic by some blocklists depending on the endpoint's hostname/path) — a source of silently missing telemetry with no error surfaced to the app, worth knowing is a real, unfixable-from-your-side gap, not a bug to chase | —               |
| 10  | Same origin instrumented by both `FetchInstrumentation` and application code manually wrapping `fetch` | Risk of double-wrapping/double span creation, same general shape as ch. 2's manual+auto double-instrumentation case                                                                                                                                                                                | ch. 2 §2.10 #12 |
