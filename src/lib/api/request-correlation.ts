import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';

const REQUEST_TRACE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export type RequestTraceContext = {
  requestId: string;
  correlationId: string;
};

export function isValidRequestTraceId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_TRACE_ID_PATTERN.test(value);
}

export function resolveRequestTraceContext(request: NextRequest): RequestTraceContext {
  const requestId = randomUUID();
  const inboundCorrelationId = request.headers.get('x-correlation-id')?.trim();
  const correlationId = isValidRequestTraceId(inboundCorrelationId)
    ? inboundCorrelationId
    : requestId;

  return { requestId, correlationId };
}

export function withRequestTraceHeaders<TResponse extends Response>(
  response: TResponse,
  trace: RequestTraceContext,
): TResponse {
  response.headers.set('X-Request-Id', trace.requestId);
  response.headers.set('X-Correlation-Id', trace.correlationId);
  return response;
}
