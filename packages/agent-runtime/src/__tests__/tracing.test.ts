import { afterEach, describe, expect, it, vi } from 'vitest';
import { startTraceSpan } from '../telemetry/tracing.js';

describe('startTraceSpan', () => {
  const originalEnv = process.env.AGENT_TRACING_ENABLED;

  afterEach(() => {
    process.env.AGENT_TRACING_ENABLED = originalEnv;
    vi.restoreAllMocks();
  });

  it('does not emit logs when tracing is disabled', () => {
    process.env.AGENT_TRACING_ENABLED = 'false';
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const span = startTraceSpan('test.span', { a: 1 });
    span.end({ done: true });

    expect(spy).not.toHaveBeenCalled();
  });

  it('emits start/end logs when tracing is enabled', () => {
    process.env.AGENT_TRACING_ENABLED = 'true';
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const span = startTraceSpan('test.span', { a: 1 });
    span.end({ done: true });

    expect(spy).toHaveBeenCalled();
    const first = String(spy.mock.calls[0]?.[0] ?? '');
    const second = String(spy.mock.calls[1]?.[0] ?? '');
    expect(first).toContain('[TraceSpan]');
    expect(first).toContain('span_start');
    expect(second).toContain('span_end');
  });
});
