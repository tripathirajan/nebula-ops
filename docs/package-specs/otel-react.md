# Package spec: `@nebula-ops/otel-react` (optional / stretch)

## Purpose

`otel-react` adds React-specific ergonomics on top of `otel-web`: automatic spans on
route changes (router-agnostic via an adapter interface), an error boundary that
records caught errors as span events, and hooks for creating/using spans inside
components. It depends on `otel-web` (for the active `WebTracerProvider`) and never
on `otel-node`. This package is explicitly a stretch goal — build only after
`otel-core` and `otel-web` are stable (see [`docs/implementation-plan.md`](../implementation-plan.md) M4).

**Design rationale lives in [`../concepts/09-otel-web-in-react.md`](../concepts/09-otel-web-in-react.md)**
— every export below (`useSpan`'s `useRef`-based lifecycle, `withRouteChangeSpans`'s
adapter shape, `OtelErrorBoundary`'s conditional span-end) traces back to a specific
React-rendering-model gotcha documented there (StrictMode double-invocation,
concurrent-rendering render-body re-invocation, what error boundaries don't catch).
That chapter also flags SSR/hydration trace-context bridging as unaddressed by the
current export list below — see open question #9 in
[`../concepts/08-why-this-layer.md`](../concepts/08-why-this-layer.md) §8.6 before
this package's scope is finalized.

## Public exports

```ts
export interface UseSpanOptions extends SpanOptions {
  autoEnd?: boolean; // default true: span ends on component unmount
}

// Creates (and by default, on unmount, ends) a span scoped to the component's
// lifetime. Re-renders do not create new spans.
export function useSpan(name: string, options?: UseSpanOptions): Span;

// Router adapter — consuming app supplies a subscribe function for its router
// (React Router, Next.js router, etc.) rather than otel-react depending on any
// specific router package.
export interface RouteChangeSource {
  subscribe(
    onChange: (route: { path: string; params?: Record<string, string> }) => void,
  ): () => void;
}

export interface RouteSpanOptions {
  spanNamePrefix?: string; // default: 'route.change'
}

export function withRouteChangeSpans(
  provider: WebTracerProvider,
  source: RouteChangeSource,
  options?: RouteSpanOptions,
): () => void; // returns unsubscribe function

// ---- Error boundary ----
export interface OtelErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode | ((error: Error) => React.ReactNode);
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

export class OtelErrorBoundary extends React.Component<OtelErrorBoundaryProps> {}

export function withOtelErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  boundaryProps?: Omit<OtelErrorBoundaryProps, 'children'>,
): React.ComponentType<P>;

export const OTEL_REACT_VERSION: string;
```

## Internal modules

| Module                                 | Responsibility                                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/hooks/use-span.ts`                | `useSpan` — creates span via active tracer from `otel-web`'s registered provider, manages lifecycle via `useEffect`.                                                   |
| `src/router/route-change-spans.ts`     | `withRouteChangeSpans`, `RouteChangeSource` — router-agnostic adapter pattern; no direct dependency on React Router/Next.js.                                           |
| `src/boundary/error-boundary.tsx`      | `OtelErrorBoundary` class component — records `componentDidCatch` errors as span events via `otel-core`-derived active span, or a dedicated error span if none active. |
| `src/boundary/with-error-boundary.tsx` | `withOtelErrorBoundary` HOC wrapper.                                                                                                                                   |
| `src/index.ts`                         | Public export barrel.                                                                                                                                                  |

## External dependencies

| Package                | Version range                          | Kind             |
| ---------------------- | -------------------------------------- | ---------------- |
| `@opentelemetry/api`   | `^1.9.0`                               | `peerDependency` |
| `@nebula-ops/otel-web` | `workspace:*` → published semver range | `dependency`     |
| `react`                | `^18.0.0 \|\| ^19.0.0`                 | `peerDependency` |

## Non-goals

- Does not depend on or bundle any specific router library — `withRouteChangeSpans`
  takes a `RouteChangeSource` adapter the consuming app implements (a handful of
  reference adapters may ship as documentation snippets, not as package code/deps).
- Does not depend on `otel-node` and must not be importable from a Node-only context
  (no SSR-specific server span logic here — that belongs to `otel-node` usage directly
  in the consuming app's server code).
- Does not replace `otel-web`'s console bridge or web-vitals bridge — those stay in
  `otel-web` since they're not React-specific.
- Not built or published until M4 in [`docs/implementation-plan.md`](../implementation-plan.md);
  treated as optional scope, may be dropped without blocking the rest of the project.
- Does not ship an SSR/hydration trace-context bridging helper (e.g. a
  `traceparent`-meta-tag reader) for v1 — real, distinct design surface specific to
  SSR frameworks ([concepts ch. 9 §9.8](../concepts/09-otel-web-in-react.md#98-server-side-rendering-and-hydration--otel-web-is-browser-only-and-the-handoff-is-a-real-gap)),
  deliberately excluded to avoid risking this already-optional package's scope
  growing past what ships. Consuming apps needing this implement the documented
  pattern themselves until/unless demand justifies adding it. See
  [ADR 0002 #9](../adr/0002-open-questions-resolutions.md#9-ssrhydration-trace-context-bridging-explicit-non-goal-for-otel-react-v1).
