// Statically resolved at build time — same pattern as otel-core/otel-node's own
// version.ts files.
import pkg from '../package.json';

export const OTEL_FASTIFY_VERSION: string = pkg.version;
