import { NextRequest } from 'next/server';

export function createMedicationIssuePatchRequest(body: unknown) {
  const versionedBody =
    body !== null && typeof body === 'object' && !Array.isArray(body)
      ? { version: 1, ...body }
      : body;
  return new NextRequest('http://localhost/api/medication-issues/issue_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(versionedBody),
  });
}

export function createMalformedMedicationIssuePatchRequest() {
  return new NextRequest('http://localhost/api/medication-issues/issue_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{"status":',
  });
}
