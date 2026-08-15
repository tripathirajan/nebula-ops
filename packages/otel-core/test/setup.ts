// Test-only setup: installs a real `ContextManager` so tests can actually verify
// context propagation (runWithLogContext/getActiveLogContext/bindLogContext, and
// span-context correlation) instead of hitting `@opentelemetry/api`'s built-in
// no-op manager, under which `context.with()` doesn't really make anything "active"
// (see docs/concepts/01-fundamentals.md §1.8 and src/context/log-context.ts's doc
// comments).
//
// `@opentelemetry/context-async-hooks` is otel-core's ONE Node-specific import in
// the whole package — and it lives here, in test/, not in src/. This is
// intentional and does not violate the "otel-core has zero Node-only imports"
// constraint (CLAUDE.md's non-negotiable rules): that constraint is about the
// package's own *production* code (src/), which callers bundle for Node or the
// browser. A devDependency used only to make otel-core's own test suite exercise
// context propagation realistically doesn't ship to consumers at all — verified by
// scripts/verify-otel-core-browser-safe.mjs, which only ever bundles src/index.ts.
import { context } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';

const contextManager = new AsyncLocalStorageContextManager();
contextManager.enable();
context.setGlobalContextManager(contextManager);
