import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NodeSDK } from '@opentelemetry/sdk-node';
import { shutdownNodeSdk, registerShutdownHandlers } from '../../src/sdk/shutdown.js';

function createFakeSdk(shutdownImpl: () => Promise<void> = () => Promise.resolve()): NodeSDK {
  return { shutdown: vi.fn(shutdownImpl) } as unknown as NodeSDK;
}

describe('shutdownNodeSdk', () => {
  it('awaits sdk.shutdown()', async () => {
    const sdk = createFakeSdk();
    await shutdownNodeSdk(sdk);
    expect(sdk.shutdown).toHaveBeenCalledTimes(1);
  });

  it('propagates a rejection from sdk.shutdown()', async () => {
    const sdk = createFakeSdk(() => Promise.reject(new Error('export failed')));
    await expect(shutdownNodeSdk(sdk)).rejects.toThrow('export failed');
  });
});

describe('registerShutdownHandlers', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let unregister: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    unregister?.();
    unregister = undefined;
    exitSpy.mockRestore();
    vi.useRealTimers();
  });

  it('registers exactly one SIGTERM and one SIGINT listener', () => {
    const before = { term: process.listenerCount('SIGTERM'), int: process.listenerCount('SIGINT') };
    const sdk = createFakeSdk();
    unregister = registerShutdownHandlers(sdk);
    expect(process.listenerCount('SIGTERM')).toBe(before.term + 1);
    expect(process.listenerCount('SIGINT')).toBe(before.int + 1);
  });

  it('the returned unregister function removes both listeners', () => {
    const before = { term: process.listenerCount('SIGTERM'), int: process.listenerCount('SIGINT') };
    const sdk = createFakeSdk();
    unregister = registerShutdownHandlers(sdk);
    unregister();
    unregister = undefined;
    expect(process.listenerCount('SIGTERM')).toBe(before.term);
    expect(process.listenerCount('SIGINT')).toBe(before.int);
  });

  it('calls sdk.shutdown() and process.exit(0) on SIGTERM', async () => {
    const sdk = createFakeSdk();
    unregister = registerShutdownHandlers(sdk);

    process.emit('SIGTERM');
    await vi.waitFor(() => expect(sdk.shutdown).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0));
  });

  it('calls sdk.shutdown() and process.exit(0) on SIGINT', async () => {
    const sdk = createFakeSdk();
    unregister = registerShutdownHandlers(sdk);

    process.emit('SIGINT');
    await vi.waitFor(() => expect(sdk.shutdown).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0));
  });

  it('ignores a second signal received while shutdown is already in progress', async () => {
    let resolveShutdown!: () => void;
    const sdk = createFakeSdk(() => new Promise<void>((resolve) => (resolveShutdown = resolve)));
    unregister = registerShutdownHandlers(sdk);

    process.emit('SIGTERM');
    process.emit('SIGTERM'); // second signal — should be a no-op while the first is in flight
    await vi.waitFor(() => expect(sdk.shutdown).toHaveBeenCalledTimes(1));

    resolveShutdown();
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0));
  });

  it('exits with code 1 if shutdown does not complete before the timeout', async () => {
    const sdk = createFakeSdk(() => new Promise<void>(() => {})); // never resolves
    unregister = registerShutdownHandlers(sdk);

    process.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(5000);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('still exits with code 0 if sdk.shutdown() rejects', async () => {
    const sdk = createFakeSdk(() => Promise.reject(new Error('export failed')));
    unregister = registerShutdownHandlers(sdk);

    process.emit('SIGTERM');
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0));
  });
});
