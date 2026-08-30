import { describe, it, expect, vi, beforeEach } from 'vitest';

// start.ts's own responsibility is *wiring* — which override vs. which default
// factory gets used for each NodeSDK option. The real behavior of each
// collaborator (resolveConfig, buildResource, the default factories, NodeSDK
// itself) is already covered by otel-core's own tests and this package's
// defaults.test.ts — re-exercising the real SDK here (real network exporters,
// real auto-instrumentation monkey-patching) would make these tests slow, order-
// -sensitive, and not actually about what start.ts itself does. So: mock every
// collaborator and assert on how start.ts calls them.
const resolveConfigMock = vi.fn();
const buildResourceMock = vi.fn();
vi.mock('@nebula-ops/otel-core', () => ({
  resolveConfig: (...args: unknown[]) => resolveConfigMock(...args),
  buildResource: (...args: unknown[]) => buildResourceMock(...args),
}));

const gatherEnvConfigSourceMock = vi.fn();
vi.mock('../../src/config/from-env.js', () => ({
  gatherEnvConfigSource: (...args: unknown[]) => gatherEnvConfigSourceMock(...args),
}));

const createDefaultContextManagerMock = vi.fn();
vi.mock('../../src/context/context-manager.js', () => ({
  createDefaultContextManager: (...args: unknown[]) => createDefaultContextManagerMock(...args),
}));

const createDefaultTraceExporterMock = vi.fn();
const createDefaultMetricReaderMock = vi.fn();
const createDefaultLogRecordProcessorMock = vi.fn();
const createDefaultInstrumentationsMock = vi.fn();
vi.mock('../../src/sdk/defaults.js', () => ({
  createDefaultTraceExporter: (...args: unknown[]) => createDefaultTraceExporterMock(...args),
  createDefaultMetricReader: (...args: unknown[]) => createDefaultMetricReaderMock(...args),
  createDefaultLogRecordProcessor: (...args: unknown[]) =>
    createDefaultLogRecordProcessorMock(...args),
  createDefaultInstrumentations: (...args: unknown[]) => createDefaultInstrumentationsMock(...args),
}));

const nodeSdkConstructorMock = vi.fn();
const startMock = vi.fn();
class FakeNodeSDK {
  constructor(...args: unknown[]) {
    nodeSdkConstructorMock(...args);
  }
  start = startMock;
}
vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: FakeNodeSDK,
}));

const { startNodeSdk } = await import('../../src/sdk/start.js');

const fakeConfig = { serviceName: 'svc' };
const fakeResource = { attributes: {} };
const fakeEnvSource = { serviceName: 'from-env' };

describe('startNodeSdk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveConfigMock.mockReturnValue(fakeConfig);
    buildResourceMock.mockReturnValue(fakeResource);
    gatherEnvConfigSourceMock.mockReturnValue(fakeEnvSource);
    createDefaultContextManagerMock.mockReturnValue('default-context-manager');
    createDefaultTraceExporterMock.mockReturnValue('default-trace-exporter');
    createDefaultMetricReaderMock.mockReturnValue('default-metric-reader');
    createDefaultLogRecordProcessorMock.mockReturnValue('default-log-processor');
    createDefaultInstrumentationsMock.mockReturnValue(['default-instrumentation']);
  });

  it('resolves config via otel-core, passing options as overrides and the gathered env as source', () => {
    const options = { serviceName: 'explicit' };
    startNodeSdk(options);
    expect(gatherEnvConfigSourceMock).toHaveBeenCalledTimes(1);
    expect(resolveConfigMock).toHaveBeenCalledWith(options, fakeEnvSource);
  });

  it('defaults options to {} when called with no arguments', () => {
    startNodeSdk();
    expect(resolveConfigMock).toHaveBeenCalledWith({}, fakeEnvSource);
  });

  it('builds the resource from the resolved config', () => {
    startNodeSdk();
    expect(buildResourceMock).toHaveBeenCalledWith(fakeConfig);
  });

  it('uses every default factory when no overrides are supplied', () => {
    startNodeSdk();
    expect(nodeSdkConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: fakeResource,
        contextManager: 'default-context-manager',
        traceExporter: 'default-trace-exporter',
        metricReaders: ['default-metric-reader'],
        logRecordProcessors: ['default-log-processor'],
        instrumentations: ['default-instrumentation'],
      }),
    );
  });

  it('uses the explicit contextManager override instead of the default when provided', () => {
    startNodeSdk({ contextManager: 'custom-context-manager' as never });
    expect(createDefaultContextManagerMock).not.toHaveBeenCalled();
    expect(nodeSdkConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({ contextManager: 'custom-context-manager' }),
    );
  });

  it('uses the explicit traceExporter override instead of the default when provided', () => {
    startNodeSdk({ traceExporter: 'custom-exporter' as never });
    expect(createDefaultTraceExporterMock).not.toHaveBeenCalled();
    expect(nodeSdkConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({ traceExporter: 'custom-exporter' }),
    );
  });

  it('uses the explicit metricReader override instead of the default when provided', () => {
    startNodeSdk({ metricReader: 'custom-reader' as never });
    expect(createDefaultMetricReaderMock).not.toHaveBeenCalled();
    expect(nodeSdkConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({ metricReaders: ['custom-reader'] }),
    );
  });

  it('uses the explicit logRecordProcessor override instead of the default when provided', () => {
    startNodeSdk({ logRecordProcessor: 'custom-processor' as never });
    expect(createDefaultLogRecordProcessorMock).not.toHaveBeenCalled();
    expect(nodeSdkConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({ logRecordProcessors: ['custom-processor'] }),
    );
  });

  it('uses the explicit instrumentations override instead of the default when provided', () => {
    startNodeSdk({ instrumentations: [] });
    expect(createDefaultInstrumentationsMock).not.toHaveBeenCalled();
    expect(nodeSdkConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({ instrumentations: [] }),
    );
  });

  it('calls sdk.start() exactly once and returns the constructed sdk', () => {
    const sdk = startNodeSdk();
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(sdk).toBeInstanceOf(FakeNodeSDK);
  });

  it('propagates a resolveConfig error (e.g. missing serviceName) without constructing a NodeSDK', () => {
    resolveConfigMock.mockImplementation(() => {
      throw new Error('serviceName is required');
    });
    expect(() => startNodeSdk()).toThrow('serviceName is required');
    expect(nodeSdkConstructorMock).not.toHaveBeenCalled();
  });
});
