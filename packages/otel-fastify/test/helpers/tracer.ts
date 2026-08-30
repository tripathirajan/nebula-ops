import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

/**
 * A fresh, isolated tracer provider + in-memory exporter per call — `SimpleSpanProcessor`
 * (not `BatchSpanProcessor`) is deliberate here: tests need exported spans available
 * immediately after `.end()`, not after a batch timer (see
 * docs/concepts/05-processing-and-batching.md §5.2's "test-only use of this idea,
 * not a production pattern"). Not registered globally — call `.getTracer(...)`
 * directly rather than going through `trace.getTracer()`, so tests stay isolated
 * from each other without needing to unregister a global provider.
 */
export function createTestTracing() {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const tracer = provider.getTracer('test');
  return { tracer, exporter, provider };
}
