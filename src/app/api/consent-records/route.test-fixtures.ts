import { NextRequest } from 'next/server';

export function createConsentRecordsRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'x-org-id': 'org_1',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export function createMalformedConsentRecordPostRequest(url: string) {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'x-org-id': 'org_1',
      'content-type': 'application/json',
    },
    body: '{"patient_id":',
  });
}

export function buildConsentAuthContext(role: string) {
  return {
    orgId: 'org_1',
    userId: 'user_1',
    role,
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
    requestId: 'request_1',
    correlationId: 'correlation_1',
  };
}
