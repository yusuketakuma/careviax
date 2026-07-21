import { NextRequest } from 'next/server';

export const CURRENT_UPDATED_AT = '2026-06-18T00:00:00.000Z';
export const CURRENT_UPDATED_AT_DATE = new Date(CURRENT_UPDATED_AT);
export const HOSTILE_TRACING_REPORT_ID = 'tracing/with space%2F?x=#';
export const HOSTILE_TRACING_REPORT_PDF_URL =
  '/api/tracing-reports/tracing%2Fwith%20space%252F%3Fx%3D%23/pdf';

export function createResolveFollowupRequest(body: unknown) {
  return new NextRequest('http://localhost/api/communication-requests/request_1/resolve-followup', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'untrusted_request_id',
      'x-correlation-id': 'correlation_1',
    },
    body: JSON.stringify(body),
  });
}
