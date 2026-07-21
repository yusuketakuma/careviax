import { expect } from 'vitest';
import { NextRequest } from 'next/server';

const PATIENT_DETAIL_URL = 'http://localhost/api/patients/patient_1';
const SENSITIVE_NO_STORE = 'private, no-store, max-age=0';

export function createPatientDetailRequest(body?: unknown, headers?: Record<string, string>) {
  if (body === undefined) {
    return new NextRequest(PATIENT_DETAIL_URL, { headers });
  }

  return new NextRequest(PATIENT_DETAIL_URL, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

export function createMalformedPatientDetailPatchRequest(headers?: Record<string, string>) {
  return new NextRequest(PATIENT_DETAIL_URL, {
    method: 'PATCH',
    body: '{"name":',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

export function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe(SENSITIVE_NO_STORE);
  expect(response.headers.get('Pragma')).toBe('no-cache');
}
