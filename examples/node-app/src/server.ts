// Deliberately imported AFTER instrumentation.ts has already run (see
// package.json's `dev` script and instrumentation.ts's own top comment) — this is
// what lets @opentelemetry/instrumentation-http and -express patch these modules
// before this file (or express itself) is ever loaded.
import express, { type Request, type Response, type NextFunction } from 'express';
import { trace, SpanStatusCode } from '@nebula-ops/otel-node';
import { logger } from './logger.js';

const tracer = trace.getTracer('node-app-example');

const app = express();
app.use(express.json());

// A request-scoped logger middleware is unnecessary here — `logger` calls
// anywhere during request handling automatically pick up the active span via
// createPinoMixin's mixin, per docs/concepts/04-logging-integration.md §4.4. No
// per-request logger instance or manual context passing needed.
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info({ method: req.method, path: req.path }, 'incoming request');
  next();
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

interface Order {
  id: string;
  totalCents: number;
}

// Simulates a slow-ish datastore lookup — enough to be visible as its own span
// duration when you look at the trace, without actually needing a real database
// for this example.
async function fetchOrder(orderId: string): Promise<Order> {
  return tracer.startActiveSpan('orders.fetch_from_store', async (span) => {
    try {
      span.setAttribute('order.id', orderId);
      await new Promise((resolve) => setTimeout(resolve, 20));

      if (orderId === 'missing') {
        throw new Error(`Order ${orderId} not found`);
      }

      const order: Order = { id: orderId, totalCents: 4200 };
      span.setAttribute('order.total_cents', order.totalCents);
      span.setStatus({ code: SpanStatusCode.OK });
      return order;
    } catch (err) {
      // The recordException + setStatus pairing documented in
      // docs/concepts/02-otel-node.md §2.4 — recordException alone adds an event
      // but doesn't mark the span as an error; both are needed.
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}

app.get('/orders/:id', async (req: Request<{ id: string }>, res: Response) => {
  // This whole route handler already runs inside the auto-instrumented HTTP
  // server span (from @opentelemetry/instrumentation-http /
  // instrumentation-express) — `orders.fetch_from_store` above nests under it
  // automatically via context.active(), with zero manual span-linking here.
  try {
    const order = await fetchOrder(req.params.id);
    logger.info({ orderId: order.id }, 'order fetched successfully');
    res.json(order);
  } catch (err) {
    logger.error({ err, orderId: req.params.id }, 'failed to fetch order');
    res.status(404).json({ error: (err as Error).message });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  logger.info({ port }, 'node-app example listening');
  // eslint-disable-next-line no-console -- deliberate example-only startup banner
  console.log(`\nTry it:\n  curl http://localhost:${port}/health`);
  // eslint-disable-next-line no-console
  console.log(`  curl http://localhost:${port}/orders/123`);
  // eslint-disable-next-line no-console
  console.log(`  curl http://localhost:${port}/orders/missing   # demonstrates the error path\n`);
});
