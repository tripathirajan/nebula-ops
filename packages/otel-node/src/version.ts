// Statically resolved at build time by the bundler, same pattern (and same
// reasoning) as @nebula-ops/otel-core's src/version.ts — not a runtime file read.
import pkg from '../package.json';

export const OTEL_NODE_VERSION: string = pkg.version;
