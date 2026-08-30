import { describe, it, expect } from 'vitest';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { createDefaultContextManager } from '../../src/context/context-manager.js';

describe('createDefaultContextManager', () => {
  it('returns an AsyncLocalStorageContextManager instance', () => {
    expect(createDefaultContextManager()).toBeInstanceOf(AsyncLocalStorageContextManager);
  });

  it('returns a fresh instance on every call', () => {
    expect(createDefaultContextManager()).not.toBe(createDefaultContextManager());
  });
});
