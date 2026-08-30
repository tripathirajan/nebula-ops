import { describe, it, expect } from 'vitest';
import { ConfigError } from '../../src/config/errors.js';

describe('ConfigError', () => {
  it('is an instance of Error and of itself', () => {
    const err = new ConfigError([{ path: 'serviceName', message: 'is required' }]);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.name).toBe('ConfigError');
  });

  it('exposes the issues array unchanged', () => {
    const issues = [
      { path: 'serviceName', message: 'is required' },
      { path: 'sampling.ratio', message: 'must be between 0 and 1' },
    ];
    const err = new ConfigError(issues);
    expect(err.issues).toEqual(issues);
  });

  it('formats a message line per issue, with its path', () => {
    const err = new ConfigError([
      { path: 'serviceName', message: 'is required' },
      { path: 'sampling.ratio', message: 'must be between 0 and 1' },
    ]);
    expect(err.message).toContain('serviceName: is required');
    expect(err.message).toContain('sampling.ratio: must be between 0 and 1');
  });

  it('formats a whole-value issue with no path without a dangling colon', () => {
    const err = new ConfigError([{ path: '', message: 'must be an object' }]);
    expect(err.message).toContain('- must be an object');
    expect(err.message).not.toContain(': must be an object');
  });
});
