// Same reasoning as @nebula-ops/otel-core's test/setup.ts: without a real
// ContextManager installed, @opentelemetry/api's built-in no-op manager makes
// context.with()/context.active() non-functional for test purposes (the no-op
// manager's `.with()` calls the callback but never actually makes the given
// context "active"). otel-node ships AsyncLocalStorageContextManager as a real
// runtime dependency (not just a test-only one, unlike otel-core), so this just
// installs the package's own real default context manager for its test suite.
import { context } from '@opentelemetry/api';
import { createDefaultContextManager } from '../src/context/context-manager.js';

const contextManager = createDefaultContextManager();
contextManager.enable();
context.setGlobalContextManager(contextManager);
