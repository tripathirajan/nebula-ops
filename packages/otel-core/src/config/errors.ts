/** One field-level validation failure, in `ConfigError.issues`. */
export interface ConfigIssue {
  /** Dot-path to the offending field, e.g. `"sampling.ratio"`. `""` for a
   * top-level/whole-value failure. */
  readonly path: string;
  readonly message: string;
}

/**
 * Thrown by {@link validateConfig} (and internally by {@link resolveConfig}) when a
 * `OtelConfig` fails validation. Carries every failing field at once (via
 * `issues`), not just the first, so a caller can report everything wrong in one pass
 * rather than fixing one field, re-running, and discovering the next.
 */
export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(ConfigError.formatMessage(issues));
    this.name = 'ConfigError';
    this.issues = issues;
    // Restores the prototype chain — without this, `instanceof ConfigError`
    // can return false when the class is extended/compiled down (a well-known TS
    // gotcha when targeting ES2022+ and extending a built-in like Error).
    Object.setPrototypeOf(this, ConfigError.prototype);
  }

  private static formatMessage(issues: readonly ConfigIssue[]): string {
    const lines = issues.map((issue) =>
      issue.path ? `  - ${issue.path}: ${issue.message}` : `  - ${issue.message}`,
    );
    return `Invalid @nebula-ops/otel-core config:\n${lines.join('\n')}`;
  }
}
