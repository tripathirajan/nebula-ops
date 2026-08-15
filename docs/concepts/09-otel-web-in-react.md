# 9. Using `otel-web`'s foundations inside a React application — tutorial and scenario reference

**There is no separate OpenTelemetry SDK for React.** Everything in this chapter is
the same `WebTracerProvider`/instrumentation/context-propagation machinery from
chapter 3, used _inside_ a React app — the interesting content here is entirely about
where React's own model (component lifecycle, StrictMode, concurrent rendering,
SSR/hydration) creates friction or grey areas that a plain (non-framework) browser
app in chapter 3 never has to deal with. Read chapter 3 first — this chapter assumes
it and doesn't repeat the Zone-vs-Stack, CORS, or web-vitals material.

**Official references used throughout this chapter:**

- React `StrictMode` (double-invocation in development): https://react.dev/reference/react/StrictMode
- React `useEffect` timing and cleanup: https://react.dev/reference/react/useEffect
- React error boundaries: https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary
- React Router data APIs (for route-change hooks): https://reactrouter.com/en/main/hooks/use-navigation
- Next.js built-in OpenTelemetry support: https://nextjs.org/docs/app/building-your-application/optimizing/open-telemetry
- React 18 concurrent rendering overview: https://react.dev/blog/2022/03/29/react-v18#what-is-concurrent-react
- `@testing-library/react`: https://testing-library.com/docs/react-testing-library/intro/

---

## 9.1 Where this sits relative to chapter 3 and the `otel-react` package spec

This chapter is about **patterns**, using only `@opentelemetry/api` +
`@opentelemetry/sdk-trace-web` + plain React — nothing `@nebula-ops`-specific.
[`../package-specs/otel-react.md`](../package-specs/otel-react.md) is the frozen API
surface this repo intends to ship (`useSpan`, `withRouteChangeSpans`,
`OtelErrorBoundary`) — treat this chapter as the "why does it need to look like
that" behind those specific exports, and as coverage of a few scenarios (SSR/hydration
context bridging, concurrent-rendering span correctness, testing) the package spec
doesn't currently address explicitly, flagged as open questions in §9.9.

## 9.2 Bootstrapping — once, at module scope, before React renders

```tsx
// tracing.ts — imported once, at the very top of the app's real entry point
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { ZoneContextManager } from '@opentelemetry/context-zone';

const provider = new WebTracerProvider({
  spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: '/api/otlp/v1/traces' }))],
});
provider.register({ contextManager: new ZoneContextManager() });

registerInstrumentations({
  instrumentations: [
    new FetchInstrumentation({
      propagateTraceHeaderCorsUrls: [/^https:\/\/api\.internal\.example\.com/],
    }),
    new DocumentLoadInstrumentation(),
  ],
});

export const tracer = provider.getTracer('checkout-web');
```

```tsx
// main.tsx — this import must run before ReactDOM renders anything
import './tracing'; // side-effecting import — registers the provider/instrumentations
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(<App />);
```

**The mistake this avoids, stated explicitly:** initializing `WebTracerProvider`
_inside_ a React component (even the top-level `App` component, even in a
`useEffect` with an empty dependency array) means instrumentation registration
happens **after** React has already started rendering and (with `StrictMode`, §9.3)
potentially after some effects have already fired once. `FetchInstrumentation`
patches the global `window.fetch` — any fetch call issued before that patch is
installed (e.g. a fetch kicked off by a component that mounts before your tracing
setup's effect runs) is simply un-instrumented, silently, exactly like chapter 2's
Node `--require` ordering problem but for a different reason (global-patch timing
here, not module-load-hook timing).

## 9.3 StrictMode's double-invocation — a genuinely React-specific gotcha

In development, `React.StrictMode` intentionally double-invokes component render
bodies, effect setup functions, and (in newer React versions) effect cleanup
functions, specifically to surface bugs in code that isn't resilient to being mounted/
unmounted/remounted. This interacts badly with tracing code placed inside a
component or hook rather than at module scope (§9.2):

```tsx
// WRONG — span created in a component body/effect without idempotency in mind
function CheckoutPage() {
  useEffect(() => {
    const span = tracer.startSpan('checkout_page.view'); // ← StrictMode calls this
    //   effect's setup TWICE
    //   in development
    return () => span.end();
  }, []);
  // ...
}
```

Under `StrictMode` in development, React runs this effect's setup, then immediately
runs its cleanup, then runs setup again (verifying the effect is safe to
mount/unmount/remount) — so **two spans are created**, and if the cleanup function is
correctly written (as above), both get ended correctly; the visible symptom is just
"twice as many `checkout_page.view` spans as page views, only in development." This
is not a tracing bug — it's `StrictMode` doing exactly what it's documented to do —
but it's worth knowing about explicitly so it isn't mistaken for a real duplicate-
span bug when someone first notices it in a dev trace viewer, and worth **not**
"fixing" by removing the cleanup function (which would break real double-mount
resilience) or by adding fragile module-level guards to suppress the second span
(which then risks suppressing a legitimately different second mount later). The
correct mental model: StrictMode's double-invocation is development-only (it does not
happen in a production build), so this is a dev-trace-viewer noise issue, not a
production data-quality issue — worth stating explicitly to whoever's confused by it,
rather than trying to engineer around it.

## 9.4 Component-scoped spans — the `useSpan` pattern

```tsx
function useSpan(name: string, options?: SpanOptions) {
  const spanRef = useRef<Span | null>(null);
  if (!spanRef.current) {
    spanRef.current = tracer.startSpan(name, options); // created once, on first render
  }
  useEffect(() => {
    return () => {
      spanRef.current?.end(); // ended once, on unmount
      spanRef.current = null;
    };
  }, []);
  return spanRef.current;
}
```

**Why `useRef` + lazy-init rather than `useState`/`useMemo`:** a span needs to be
created exactly once per component instance and live for that instance's full
mounted lifetime — `useMemo` is documented by React as a _performance_ hint, not a
lifetime guarantee (React is explicitly allowed to discard and recompute a memoized
value, e.g. under certain concurrent-rendering scenarios, §9.7), so relying on it for
something with real side effects (a span that must be `.end()`-able exactly once) is
fragile. `useRef` combined with lazy-initialization inside the render body (guarded
by `if (!spanRef.current)`) is the pattern that survives React's rendering
flexibility, at the cost of being less obviously idiomatic than `useMemo` to a reader
unfamiliar with why it's written this way — worth a code comment at the call site
explaining the choice, since "why not just `useMemo`" is a predictable review
question.

**Re-renders do not create new spans** with this pattern — the span persists across
however many times the component re-renders, only starting on first mount and ending
on unmount, which matches the semantic intent ("this span represents the component
being on screen"), not "this span represents one render pass."

## 9.5 Route-change spans — router-agnostic by necessity

There is no single React routing library — React Router, Next.js's router (Pages or
App Router), TanStack Router, Remix, and hand-rolled routers all have different APIs
for "tell me when navigation happens." A route-change-span helper has to be written
against an **adapter interface**, not any one router directly:

```tsx
interface RouteChangeSource {
  subscribe(onChange: (route: { path: string }) => void): () => void; // returns unsubscribe
}

function withRouteChangeSpans(source: RouteChangeSource) {
  let previousSpan: Span | null = null;
  return source.subscribe(({ path }) => {
    previousSpan?.end(); // end the span for the route we're navigating away from
    previousSpan = tracer.startSpan('route.change', { attributes: { 'route.path': path } });
  });
}

// React Router v6 adapter (illustrative — actual API surface varies by Router version):
function createReactRouterAdapter(router: RemixRouter): RouteChangeSource {
  return {
    subscribe(onChange) {
      return router.subscribe((state) => onChange({ path: state.location.pathname }));
    },
  };
}

withRouteChangeSpans(createReactRouterAdapter(router));
```

**Grey area worth flagging:** "when did the route change" and "when did the new
route's content finish rendering/loading" are different moments, and which one a
`route.change` span should measure is itself a design choice. A span that starts at
navigation-intent and ends only when the new route's data-fetching/rendering is
actually complete (closer to what users perceive as "page load speed") requires
wiring the span's end to whatever loading-state signal the router/data-fetching
library exposes (e.g. React Router's `useNavigation().state === 'idle'`,
or a Suspense boundary resolving, §9.7) rather than ending it immediately on the
navigation event itself — the naive version above measures only "did navigation
start," which is a real but much less useful signal on its own.

## 9.6 Error boundaries → span events

```tsx
class OtelErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const span = trace.getSpan(context.active()) ?? tracer.startSpan('react.error_boundary');
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.setAttribute('react.component_stack', info.componentStack ?? '');
    if (!trace.getSpan(context.active())) span.end(); // only end it if we created it here
  }

  render() {
    return this.state.hasError ? (this.props.fallback ?? null) : this.props.children;
  }
}
```

**The conditional `span.end()` is deliberate, not a stylistic choice:** if there's
already an active span (e.g. a route-change span from §9.5 that's still open while
this component was rendering under it), the error should be recorded as an event
_on that existing span_ rather than manufacturing an unrelated new one — but if
there's no active span at all (a boundary catching an error outside any traced
operation), a dedicated span is the only way to get the error recorded at all, and
that one genuinely needs to be ended here since nothing else owns its lifecycle.
Getting this backwards (always creating a new span) produces disconnected
single-span "traces" for every caught error even when a perfectly good parent span
was already active and would have made the error queryable in context.

**React error boundaries do not catch every kind of error** — per React's own docs,
they don't catch errors in event handlers, async code (e.g. inside a `useEffect`'s
promise), server-side rendering, or errors thrown in the boundary itself. Each of
those needs its own explicit `try/catch` (or a global `window.addEventListener('error', ...)`/
`unhandledrejection` handler) wired to the same `recordException` pattern if you want
comparable coverage — `OtelErrorBoundary` alone only covers the specific "error
thrown during rendering" case React's boundary mechanism itself covers.

## 9.7 React 18 concurrent rendering — a real, currently-open correctness question

React 18's concurrent renderer can **pause, abandon, or replay** a render pass
(e.g. to prioritize a more urgent update, or when a component suspends). This
matters directly for the context-propagation mechanisms chapter 3 §3.4 described:

- `ZoneContextManager`'s zone.js patches async primitives, but React's internal
  scheduler (`useTransition`, Suspense-driven "off-screen" rendering, automatic
  batching) does not go through the DOM/browser async APIs zone.js instruments in
  the way a plain `setTimeout`/`fetch` call does — it's React's own internal
  scheduling, opaque to zone.js. Whether "the active span at the time
  `startTransition`'s callback runs" is what you'd intuitively expect is not
  something either `ZoneContextManager` or `StackContextManager` was designed with
  React's concurrent scheduler specifically in mind for.
- A render pass that starts, gets abandoned (because a higher-priority update
  preempted it), and is later restarted from scratch means any span created directly
  in a component's render body (rather than in an effect, which only runs after a
  render actually commits) can be created **more than once for a single logical
  render**, with no corresponding "abandoned" signal to end the extras — this is a
  concrete reason §9.4's pattern deliberately creates the span in a lazily-initialized
  `useRef` guarded by a null-check (survives being called multiple times safely,
  since only the first call's result is kept) rather than unconditionally in the
  render body.

**Practical guidance given this is a genuinely open area (not something with a clean,
documented, official answer as of the OTel/React versions this repo targets):**
prefer creating spans in `useEffect` (which only fires after a render actually
commits, not during speculative/abandoned render attempts) over creating them
directly in a component's render body whenever the choice is available, and treat
any span whose timing needs to be exactly correct relative to React's internal
scheduling (as opposed to "roughly, when this component was on screen") as needing
its own explicit verification rather than an assumption that either context manager
handles it correctly by default.

## 9.8 Server-side rendering and hydration — `otel-web` is browser-only, and the handoff is a real gap

If the app uses SSR (Next.js, Remix, or similar), the **server-rendered HTML is not
produced by `otel-web` at all** — that's Node code, instrumented (if at all) by
`otel-node`/chapter 2's tooling, running in a completely separate process from the
browser that later hydrates the page. Two distinct problems this creates:

1. **`otel-web` must never be imported/initialized in server-rendered code** —
   `WebTracerProvider`/`ZoneContextManager`/browser instrumentations assume `window`/
   `document` exist; importing them in a Node SSR context will throw or behave
   incorrectly. Framework-specific guards (e.g. checking `typeof window !== 'undefined'`
   before the bootstrap in §9.2, or using a framework's documented client-only-code
   convention — Next.js `'use client'` boundaries, dynamic imports with SSR disabled)
   are required, not optional.
2. **Trace continuity across the SSR→hydration boundary is not automatic.** The
   server-side request that rendered the HTML has its own trace (from `otel-node`);
   the browser's subsequent `otel-web` spans (starting with `DocumentLoadInstrumentation`,
   chapter 3 §3.9) start a **new, unrelated trace** by default — there's no built-in
   mechanism that says "this page load is a continuation of the server request that
   rendered it." Bridging this requires deliberately passing the server's trace
   context to the client, typically by embedding the `traceparent` value the server
   generated into the initial HTML (a `<meta>` tag or inline script) and having the
   client-side bootstrap read it and use it — as a **Link** (chapter 1 §1.2), not as a
   direct parent, since the server request and the client page-load are related but
   not a strict parent-child call relationship — when creating its first spans:

```html
<!-- injected by the server, alongside the rendered HTML -->
<meta name="traceparent" content="00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" />
```

```tsx
// client bootstrap — read it once, link (not parent) the first client span to it
const serverTraceparent = document
  .querySelector('meta[name="traceparent"]')
  ?.getAttribute('content');
const link = serverTraceparent
  ? { context: parseTraceparentIntoSpanContext(serverTraceparent) }
  : undefined;
const initialSpan = tracer.startSpan('client.hydrate', { links: link ? [link] : [] });
```

**Next.js specifically** ships its own built-in OpenTelemetry integration (linked
above) for the server side, which is worth being aware of as a separate, official
mechanism rather than assuming `otel-node`'s manual bootstrap (chapter 2) is the only
option in a Next.js server context — but that built-in support is still server-side
only; the client/hydration-side bridging problem above is unaffected by it and is not
solved by Next.js's own tooling as of the versions this repo targets.

## 9.9 Testing React components with OTel spans

```tsx
import { render, screen } from '@testing-library/react';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';

const exporter = new InMemorySpanExporter();
const provider = new WebTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
provider.register();

test('CheckoutPage records a view span on mount and ends it on unmount', () => {
  const { unmount } = render(<CheckoutPage />);
  unmount();

  const spans = exporter.getFinishedSpans();
  expect(spans.some((s) => s.name === 'checkout_page.view')).toBe(true);
});
```

`SimpleSpanProcessor` (chapter 5 §5.2), not `BatchSpanProcessor`, is the right choice
here — same reasoning as chapter 7 §7.7's testing example: a test needs the span
available for assertion immediately after `unmount()` runs, not after some batch
timer elapses. Worth resetting `exporter.reset()` between tests (or constructing a
fresh provider per test) to avoid one test's spans leaking into the next test's
assertions, same caution as chapter 7 §7.9's edge case #4.

## 9.10 Edge cases and grey areas checklist

| #   | Scenario                                                                                                     | What actually happens                                                                                                                                                                                           | Reference  |
| --- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | Tracing bootstrap placed inside a component/`useEffect` instead of module scope                              | Fetch calls issued by components that mount before that effect runs go un-instrumented, silently                                                                                                                | §9.2       |
| 2   | `StrictMode` in development                                                                                  | Effect-created spans are created twice (setup→cleanup→setup) — expected dev-only noise, not a production bug, and not something to "fix" by removing cleanup or adding fragile guards                           | §9.3       |
| 3   | Span created unconditionally in a component's render body rather than via lazy-`useRef`/`useEffect`          | Concurrent rendering (§9.7) can invoke the render body multiple times per logical render, creating extra untracked spans with no cleanup signal                                                                 | §9.4, §9.7 |
| 4   | Route-change span ended immediately on navigation event rather than on route content actually finishing load | Measures "did navigation start," not perceived page-load speed — a much weaker signal than usually intended                                                                                                     | §9.5       |
| 5   | Error boundary always creates a new span for `recordException` regardless of whether one was already active  | Disconnected single-span "traces" for errors that occurred inside an otherwise well-traced operation, losing the surrounding context                                                                            | §9.6       |
| 6   | Error thrown inside a `useEffect`'s async code or an event handler                                           | Not caught by `OtelErrorBoundary` at all — React boundaries only catch render-phase errors; needs separate `try/catch`/global handler coverage                                                                  | §9.6       |
| 7   | `useTransition`/Suspense-driven concurrent updates relied on for exact span-timing correctness               | No documented, official guarantee either `ZoneContextManager` or `StackContextManager` correctly tracks context across React's internal scheduler — treat as needing explicit verification, not assumed correct | §9.7       |
| 8   | `otel-web` bootstrap accidentally imported/run in server-rendered (SSR) code                                 | Throws or misbehaves — `WebTracerProvider`/browser instrumentations assume `window`/`document` exist; needs an explicit client-only guard per the framework's convention                                        | §9.8       |
| 9   | SSR app with no explicit trace-context bridging between server render and client hydration                   | Server-side and client-side traces for the "same" page load are completely disconnected by default — not a bug, just an unaddressed gap unless deliberately bridged via `traceparent` injection + Links         | §9.8       |
| 10  | Test suite reuses one `InMemorySpanExporter`/provider across multiple test files without resetting           | Spans from an earlier test leak into a later test's assertions                                                                                                                                                  | §9.9       |
