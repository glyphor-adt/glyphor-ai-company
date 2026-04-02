import { randomUUID } from 'node:crypto';

type TracePrimitive = string | number | boolean | null | undefined;
export type TraceAttributes = Record<string, TracePrimitive>;

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);

function isTracingEnabled(): boolean {
  const raw = process.env.AGENT_TRACING_ENABLED?.trim().toLowerCase();
  return raw ? TRUTHY_VALUES.has(raw) : false;
}

function buildSpanId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

function serializeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function emitTrace(event: Record<string, unknown>): void {
  if (!isTracingEnabled()) return;
  console.log(`[TraceSpan] ${JSON.stringify(event)}`);
}

export interface TraceSpan {
  readonly traceId: string;
  readonly spanId: string;
  end(extraAttributes?: TraceAttributes): void;
  fail(error: unknown, extraAttributes?: TraceAttributes): void;
}

export function startTraceSpan(
  name: string,
  attributes: TraceAttributes = {},
  options: { traceId?: string; parentSpanId?: string } = {},
): TraceSpan {
  const traceId = options.traceId ?? randomUUID().replace(/-/g, '');
  const spanId = buildSpanId();
  const startMs = Date.now();
  let closed = false;

  emitTrace({
    event: 'span_start',
    name,
    trace_id: traceId,
    span_id: spanId,
    parent_span_id: options.parentSpanId,
    timestamp: new Date(startMs).toISOString(),
    attributes,
  });

  const close = (status: 'ok' | 'error', payload: TraceAttributes = {}, error?: unknown) => {
    if (closed) return;
    closed = true;
    const endMs = Date.now();
    emitTrace({
      event: 'span_end',
      name,
      trace_id: traceId,
      span_id: spanId,
      status,
      duration_ms: endMs - startMs,
      timestamp: new Date(endMs).toISOString(),
      attributes: payload,
      ...(error !== undefined ? { error: serializeError(error) } : {}),
    });
  };

  return {
    traceId,
    spanId,
    end(extraAttributes?: TraceAttributes) {
      close('ok', extraAttributes ?? {});
    },
    fail(error: unknown, extraAttributes?: TraceAttributes) {
      close('error', extraAttributes ?? {}, error);
    },
  };
}
