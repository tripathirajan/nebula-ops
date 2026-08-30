// Same reasoning as otel-core's and otel-node's test/setup.ts: without a real
// ContextManager installed, @opentelemetry/api's built-in no-op manager makes
// context.with()/context.active() non-functional for test purposes.
import { context } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';

const contextManager = new AsyncLocalStorageContextManager();
contextManager.enable();
context.setGlobalContextManager(contextManager);
