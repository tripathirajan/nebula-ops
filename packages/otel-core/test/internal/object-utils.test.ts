import { describe, it, expect } from 'vitest';
import { stripUndefined, isPlainObject } from '../../src/internal/object-utils.js';

describe('stripUndefined', () => {
  it('removes keys whose value is undefined', () => {
    expect(stripUndefined({ a: 1, b: undefined, c: 'x' })).toEqual({ a: 1, c: 'x' });
  });

  it('keeps keys whose value is falsy but not undefined', () => {
    expect(stripUndefined({ a: 0, b: '', c: null, d: false })).toEqual({
      a: 0,
      b: '',
      c: null,
      d: false,
    });
  });

  it('returns an equivalent object when nothing is undefined', () => {
    expect(stripUndefined({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it('returns an empty object for an empty input', () => {
    expect(stripUndefined({})).toEqual({});
  });
});

describe('isPlainObject', () => {
  it('is true for a plain object literal', () => {
    expect(isPlainObject({ a: 1 })).toBe(true);
  });

  it('is false for null', () => {
    expect(isPlainObject(null)).toBe(false);
  });

  it('is false for an array', () => {
    expect(isPlainObject([1, 2, 3])).toBe(false);
  });

  it('is false for a string', () => {
    expect(isPlainObject('not an object')).toBe(false);
  });

  it('is false for a number', () => {
    expect(isPlainObject(42)).toBe(false);
  });

  it('is false for undefined', () => {
    expect(isPlainObject(undefined)).toBe(false);
  });
});
