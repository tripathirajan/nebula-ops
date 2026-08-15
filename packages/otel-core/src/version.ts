// Statically resolved at build time by the bundler (esbuild, via tsup) from
// package.json's "version" field — not a runtime file read (which would violate
// otel-core's environment-agnostic constraint, since fs access is Node-only). This
// keeps OTEL_CORE_VERSION in sync with the published package version automatically,
// including through Changesets' version bumps, with nothing to remember to update
// by hand.
import pkg from '../package.json';

export const OTEL_CORE_VERSION: string = pkg.version;
