import pino from 'pino';
import { createPinoMixin } from '@nebula-ops/otel-node';

// Pattern A correlation-only logging (docs/concepts/04-logging-integration.md
// §4.1/§4.5): the logger itself is completely ordinary pino — nothing about how
// it's constructed or called changes. `createPinoMixin()` is the only otel-node
// touchpoint: it merges trace_id/span_id/trace_flags into every log line based on
// whatever span is active at the moment the log call happens.
export const logger = pino({
  mixin: createPinoMixin(),
  transport: { target: 'pino-pretty', options: { colorize: true } },
});
