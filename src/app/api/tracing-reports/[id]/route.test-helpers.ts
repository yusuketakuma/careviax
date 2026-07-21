import { NextRequest } from 'next/server';
import { expect, type Mock } from 'vitest';

export const CURRENT_UPDATED_AT = '2026-03-28T04:30:00.000Z';
export const STALE_UPDATED_AT = '2026-03-28T04:29:59.000Z';
export const LINKED_REQUEST_UPDATED_AT = new Date('2026-03-28T05:30:00.000Z');

function withDefaultPatchVersion(body: unknown) {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    if (Object.prototype.hasOwnProperty.call(body, 'expected_updated_at')) return body;
    return { expected_updated_at: CURRENT_UPDATED_AT, ...body };
  }
  return body;
}

export function createRequest(body: unknown, headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/tracing-reports/tracing_1', {
    method: body === null ? 'DELETE' : 'PATCH',
    headers: {
      ...headers,
      ...(body === null ? {} : { 'content-type': 'application/json' }),
    },
    body: body === null ? undefined : JSON.stringify(withDefaultPatchVersion(body)),
  });
}

export function createMalformedPatchRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/tracing-reports/tracing_1', {
    method: 'PATCH',
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    body: '{"status":',
  });
}

export const HOSTILE_TRACING_REPORT_ID = 'tracing/with space%2F?x=#';
export const HOSTILE_TRACING_REPORT_PDF_URL =
  '/api/tracing-reports/tracing%2Fwith%20space%252F%3Fx%3D%23/pdf';

export function expectStructuredLifecycleErrorLog(
  loggerErrorMock: Mock,
  method: 'PATCH' | 'DELETE',
  error: Error,
) {
  expect(loggerErrorMock).toHaveBeenCalledWith(
    {
      event: 'tracing_report_lifecycle_unhandled_error',
      route: '/api/tracing-reports/[id]',
      method,
      status: 500,
    },
    error,
  );
  const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
  expect(logError).toBe(error);
  expect(logContext).not.toHaveProperty('error_name');
  const logged = JSON.stringify(logContext);
  expect(logged).not.toContain('山田太郎');
  expect(logged).not.toContain('raw SQL');
  expect(logged).not.toContain('stack');
  expect(logged).not.toContain(error.name);
}
