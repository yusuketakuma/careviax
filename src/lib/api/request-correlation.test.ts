import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import {
  getRequestTraceContext,
  isValidRequestTraceId,
  resolveRequestTraceContext,
  runWithRequestTraceContext,
  withRequestTraceHeaders,
} from './request-correlation';

function createRequest(correlationId?: string) {
  return new NextRequest('http://localhost/api/test', {
    headers: correlationId === undefined ? undefined : { 'x-correlation-id': correlationId },
  });
}

describe('request correlation', () => {
  it('generates a server-owned request id and preserves a safe inbound correlation id', () => {
    const trace = resolveRequestTraceContext(createRequest('workflow_123:attempt-2'));

    expect(trace.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(trace.correlationId).toBe('workflow_123:attempt-2');
  });

  it.each(['', '   ', 'contains spaces', 'patient@example.test', 'a'.repeat(129)])(
    'falls back to the server request id for an unsafe correlation id: %s',
    (correlationId) => {
      const trace = resolveRequestTraceContext(createRequest(correlationId));

      expect(trace.correlationId).toBe(trace.requestId);
    },
  );

  it('uses the same generated id when no correlation header is supplied', () => {
    const trace = resolveRequestTraceContext(createRequest());

    expect(trace.correlationId).toBe(trace.requestId);
  });

  it('adds both trace headers without replacing the response object', () => {
    const response = new Response('ok');
    const result = withRequestTraceHeaders(response, {
      requestId: 'request_1',
      correlationId: 'correlation_1',
    });

    expect(result).toBe(response);
    expect(result.headers.get('X-Request-Id')).toBe('request_1');
    expect(result.headers.get('X-Correlation-Id')).toBe('correlation_1');
  });

  it('exposes the shared trace-id validator for persistence boundaries', () => {
    expect(isValidRequestTraceId('request_1:attempt-2')).toBe(true);
    expect(isValidRequestTraceId('patient@example.test')).toBe(false);
  });

  it('restores nested async trace scopes and does not leak after completion', async () => {
    const outer = { requestId: 'request_outer', correlationId: 'correlation_outer' };
    const inner = { requestId: 'request_inner', correlationId: 'correlation_inner' };

    expect(getRequestTraceContext()).toBeUndefined();
    await runWithRequestTraceContext(outer, async () => {
      expect(getRequestTraceContext()).toEqual(outer);
      await runWithRequestTraceContext(inner, async () => {
        await Promise.resolve();
        expect(getRequestTraceContext()).toEqual(inner);
      });
      expect(getRequestTraceContext()).toEqual(outer);
    });
    expect(getRequestTraceContext()).toBeUndefined();
  });

  it('isolates concurrent trace scopes', async () => {
    const traces = [
      { requestId: 'request_a', correlationId: 'correlation_a' },
      { requestId: 'request_b', correlationId: 'correlation_b' },
    ];

    const observed = await Promise.all(
      traces.map((trace) =>
        runWithRequestTraceContext(trace, async () => {
          await Promise.resolve();
          return getRequestTraceContext();
        }),
      ),
    );

    expect(observed).toEqual(traces);
    expect(getRequestTraceContext()).toBeUndefined();
  });
});
