/** One field-level validation failure, in `NebulaConfigError.issues`. */
export interface NebulaConfigIssue {
  /** Dot-path to the offending field, e.g. `"sampling.ratio"`. `""` for a
   * top-level/whole-value failure. */
  readonly path: string;
  readonly message: string;
}

/**
 * Thrown by {@link validateConfig} (and internally by {@link resolveConfig}) when a
 * `NebulaOtelConfig` fails validation. Carries every failing field at once (via
 * `issues`), not just the first, so a caller can report everything wrong in one pass
 * rather than fixing one field, re-running, and discovering the next.
 */
export class NebulaConfigError extends Error {
  readonly issues: readonly NebulaConfigIssue[];

  constructor(issues: readonly NebulaConfigIssue[]) {
    super(NebulaConfigError.formatMessage(issues));
    this.name = 'NebulaConfigError';
    this.issues = issues;
    // Restores the prototype chain — without this, `instanceof NebulaConfigError`
    // can return false when the class is extended/compiled down (a well-known TS
    // gotcha when targeting ES2022+ and extending a built-in like Error).
    Object.setPrototypeOf(this, NebulaConfigError.prototype);
  }

  private static formatMessage(issues: readonly NebulaConfigIssue[]): string {
    const lines = issues.map((issue) =>
      issue.path ? `  - ${issue.path}: ${issue.message}` : `  - ${issue.message}`,
    );
    return `Invalid @nebula-ops/otel-core config:\n${lines.join('\n')}`;
  }
}
