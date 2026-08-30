import { describe, it, expect } from 'vitest';
import { isIgnoredRoute } from '../src/matching.js';

describe('isIgnoredRoute', () => {
  it('returns false for an empty ignore list', () => {
    expect(isIgnoredRoute('/orders/:id', [])).toBe(false);
  });

  it('matches an exact string entry', () => {
    expect(isIgnoredRoute('/health', ['/health'])).toBe(true);
  });

  it('does not match a different string entry', () => {
    expect(isIgnoredRoute('/orders/:id', ['/health'])).toBe(false);
  });

  it('matches via RegExp#test', () => {
    expect(isIgnoredRoute('/internal/metrics', [/^\/internal\//])).toBe(true);
  });

  it('does not match when the RegExp does not test true', () => {
    expect(isIgnoredRoute('/orders/:id', [/^\/internal\//])).toBe(false);
  });

  it('matches if any entry in a mixed list matches', () => {
    expect(isIgnoredRoute('/health', [/^\/internal\//, '/health'])).toBe(true);
  });
});
