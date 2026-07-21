import { NextRequest } from 'next/server';

export const defaultUpdatedAt = new Date('2026-05-01T00:00:00.000Z');

export const defaultInsuranceRecord = {
  id: 'insurance_1',
  insurance_type: 'care',
  application_status: 'confirmed',
  public_program_code: null,
  valid_from: new Date('2026-04-01'),
  valid_until: new Date('2027-03-31'),
  application_submitted_at: null,
  decision_at: null,
  previous_care_level: null,
  provisional_care_level: null,
  confirmed_care_level: 'care_2',
  is_active: true,
  updated_at: defaultUpdatedAt,
};

export function createPutRequest(
  body: unknown,
  expectedUpdatedAt: string | null = defaultUpdatedAt.toISOString(),
) {
  const url = new URL('http://localhost/api/patients/patient_1/insurance/insurance_1');
  if (expectedUpdatedAt !== null) {
    url.searchParams.set('expected_updated_at', expectedUpdatedAt);
  }
  return new NextRequest(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function createInvalidJsonRequest() {
  return new NextRequest('http://localhost/api/patients/patient_1/insurance/insurance_1', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
}

export function createDeleteRequest() {
  return createGuardedDeleteRequest(defaultUpdatedAt.toISOString());
}

export function createDeleteRequestWithoutExpectedUpdatedAt() {
  return new NextRequest('http://localhost/api/patients/patient_1/insurance/insurance_1', {
    method: 'DELETE',
  });
}

export function createGuardedDeleteRequest(expectedUpdatedAt: string) {
  const url = new URL('http://localhost/api/patients/patient_1/insurance/insurance_1');
  url.searchParams.set('expected_updated_at', expectedUpdatedAt);
  return new NextRequest(url, { method: 'DELETE' });
}
