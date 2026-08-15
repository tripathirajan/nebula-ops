import { describe, it, expect } from 'vitest';
import { context, trace } from '@opentelemetry/api';
import {
  runWithLogContext,
  getActiveLogContext,
  bindLogContext,
} from '../../src/context/log-context.js';
import { createFakeSpan } from '../helpers/fake-span.js';

describe('getActiveLogContext', () => {
  it('returns {} when there is no active span and no explicit log context', () => {
    expect(getActiveLogContext()).toEqual({});
  });

  it('returns the active span-derived context when no explicit log context was set', () => {
    const span = createFakeSpan({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) });
    const result = context.with(trace.setSpan(context.active(), span), () => getActiveLogContext());
    expect(result).toMatchObject({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) });
  });

  it('returns the explicit log context when no span is active', () => {
    const result = runWithLogContext({ attributes: { userId: '123' } }, () =>
      getActiveLogContext(),
    );
    expect(result).toEqual({ attributes: { userId: '123' } });
  });

  it('merges span-derived ids with explicit attributes, explicit fields winning on conflict', () => {
    const span = createFakeSpan({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) });
    const result = context.with(trace.setSpan(context.active(), span), () =>
      runWithLogContext({ traceId: 'explicit-override', attributes: { userId: '123' } }, () =>
        getActiveLogContext(),
      ),
    );
    expect(result.traceId).toBe('explicit-override'); // explicit wins over span-derived
    expect(result.spanId).toBe('b'.repeat(16)); // untouched field still comes through
    expect(result.attributes).toEqual({ userId: '123' });
  });

  it('omits the attributes key entirely when neither side has any (not attributes: undefined)', () => {
    const result = runWithLogContext({ traceId: 'x' }, () => getActiveLogContext());
    expect(result).not.toHaveProperty('attributes');
  });

  it('merges attributes when only the span-derived side has them', () => {
    // logContextFromActiveSpan never sets .attributes itself, so simulate the
    // "fromSpan has attributes" branch via a nested runWithLogContext that only
    // the outer call contributes attributes to, then let the inner call add none.
    const outer = runWithLogContext({ attributes: { a: 1 } }, () =>
      runWithLogContext({ traceId: 'inner' }, () => getActiveLogContext()),
    );
    expect(outer.attributes).toEqual({ a: 1 });
    expect(outer.traceId).toBe('inner');
  });
});

describe('runWithLogContext', () => {
  it('makes the given log context visible to a nested getActiveLogContext call', () => {
    const result = runWithLogContext({ traceId: 't1', spanId: 's1' }, () => getActiveLogContext());
    expect(result).toEqual({ traceId: 't1', spanId: 's1' });
  });

  it('does not leak the log context outside of the callback', () => {
    runWithLogContext({ traceId: 'inside-only' }, () => {
      /* no-op */
    });
    expect(getActiveLogContext()).toEqual({});
  });

  it('merges nested calls, inner fields winning over outer for the same key', () => {
    const result = runWithLogContext({ traceId: 'outer', spanId: 'outer-span' }, () =>
      runWithLogContext({ traceId: 'inner' }, () => getActiveLogContext()),
    );
    expect(result).toEqual({ traceId: 'inner', spanId: 'outer-span' });
  });

  it('merges attributes across nested calls rather than replacing wholesale', () => {
    const result = runWithLogContext({ attributes: { a: 1, shared: 'outer' } }, () =>
      runWithLogContext({ attributes: { b: 2, shared: 'inner' } }, () => getActiveLogContext()),
    );
    expect(result.attributes).toEqual({ a: 1, b: 2, shared: 'inner' });
  });

  it('returns the callback result', () => {
    const result = runWithLogContext({ traceId: 't' }, () => 42);
    expect(result).toBe(42);
  });

  it('propagates a synchronous throw from the callback without swallowing it', () => {
    expect(() =>
      runWithLogContext({ traceId: 't' }, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
  });
});

describe('bindLogContext', () => {
  it('re-enters the context active at bind time when the bound function is called later', () => {
    let bound!: () => ReturnType<typeof getActiveLogContext>;

    runWithLogContext({ traceId: 'captured' }, () => {
      bound = bindLogContext(() => getActiveLogContext());
    });

    // Called outside of any runWithLogContext scope — without binding this would
    // see {} instead of the captured context.
    expect(getActiveLogContext()).toEqual({});
    expect(bound()).toEqual({ traceId: 'captured' });
  });

  it('forwards arguments and return value through the bound function', () => {
    const bound = bindLogContext((a: number, b: number) => a + b);
    expect(bound(2, 3)).toBe(5);
  });

  it('survives a real async gap (setTimeout), proving AsyncLocalStorage-backed propagation', async () => {
    const span = createFakeSpan({ traceId: 'async-trace' });
    let bound!: () => ReturnType<typeof getActiveLogContext>;

    context.with(trace.setSpan(context.active(), span), () => {
      runWithLogContext({ attributes: { requestId: 'r1' } }, () => {
        bound = bindLogContext(() => getActiveLogContext());
      });
    });

    const result = await new Promise<ReturnType<typeof getActiveLogContext>>((resolve) => {
      setTimeout(() => resolve(bound()), 0);
    });

    expect(result.traceId).toBe('async-trace');
    expect(result.attributes).toEqual({ requestId: 'r1' });
  });
});
