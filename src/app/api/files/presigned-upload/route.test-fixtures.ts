import { NextRequest } from 'next/server';

export const PRESCRIPTION_SHA256 = 'ab'.repeat(32);

export const validReportUploadBody = {
  purpose: 'report',
  file_name: 'report.pdf',
  mime_type: 'application/pdf',
  size_bytes: 1024,
  report_id: 'report_1',
};

export const validPrescriptionUploadBody = {
  purpose: 'prescription',
  file_name: 'prescription.pdf',
  mime_type: 'application/pdf',
  size_bytes: 1024,
  patient_id: 'patient_1',
  sha256: PRESCRIPTION_SHA256,
};

export function createRequest(body: unknown) {
  const normalizedBody =
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    'purpose' in body &&
    body.purpose !== 'prescription' &&
    !('sha256' in body)
      ? { ...body, sha256: PRESCRIPTION_SHA256 }
      : body;
  return new NextRequest('http://localhost/api/files/presigned-upload', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: JSON.stringify(normalizedBody),
  });
}

export function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/files/presigned-upload', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: '{',
  });
}

export const defaultVisitRecord = {
  id: 'visit_1',
  patient_id: 'patient_1',
  schedule: {
    pharmacist_id: 'user_1',
    case_: {
      primary_pharmacist_id: null,
      backup_pharmacist_id: null,
    },
  },
};

export const defaultCareReport = {
  id: 'report_1',
  patient_id: 'patient_1',
  case_id: null,
  visit_record_id: null,
};

export const defaultPresignedUpload = {
  id: 'file_1',
  uploadUrl: 'https://example.com/upload',
  objectKey: 'reports/org_1/report_1/file_1-report.pdf',
  storageKey: 'reports/org_1/report_1/file_1-report.pdf',
  expiresIn: 300,
  headers: { 'Content-Type': 'application/pdf' },
  orgId: 'org_1',
  patientId: 'patient_1',
  visitRecordId: 'visit_1',
  reportId: 'report_1',
  uploadedBy: 'user_1',
  etag: 'etag-1',
};
