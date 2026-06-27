import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  recordDataExportAuditMock,
  buildBillingDocumentPdfMock,
  buildCareReportPdfMock,
  buildManagementPlanPdfMock,
  buildMedicationHistoryPdfMock,
  buildMedicationCalendarPdfMock,
  buildPatientVisitRecordsPdfMock,
  buildTracingReportPdfMock,
  buildVisitRecordPdfMock,
  buildPharmacyInvoiceDocumentPdfMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  recordDataExportAuditMock: vi.fn(),
  buildBillingDocumentPdfMock: vi.fn(),
  buildCareReportPdfMock: vi.fn(),
  buildManagementPlanPdfMock: vi.fn(),
  buildMedicationHistoryPdfMock: vi.fn(),
  buildMedicationCalendarPdfMock: vi.fn(),
  buildPatientVisitRecordsPdfMock: vi.fn(),
  buildTracingReportPdfMock: vi.fn(),
  buildVisitRecordPdfMock: vi.fn(),
  buildPharmacyInvoiceDocumentPdfMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/server/services/export-audit', () => ({
  recordDataExportAudit: recordDataExportAuditMock,
}));

vi.mock('@/server/services/pdf-documents', () => ({
  buildBillingDocumentPdf: buildBillingDocumentPdfMock,
  buildCareReportPdf: buildCareReportPdfMock,
  buildManagementPlanPdf: buildManagementPlanPdfMock,
  buildMedicationHistoryPdf: buildMedicationHistoryPdfMock,
  buildMedicationCalendarPdf: buildMedicationCalendarPdfMock,
  buildPatientVisitRecordsPdf: buildPatientVisitRecordsPdfMock,
  buildTracingReportPdf: buildTracingReportPdfMock,
  buildVisitRecordPdf: buildVisitRecordPdfMock,
}));

vi.mock('@/server/services/pdf-pharmacy-invoice', () => ({
  buildPharmacyInvoiceDocumentPdf: buildPharmacyInvoiceDocumentPdfMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

import { GET as careReportPdfGet } from '../care-reports/[id]/pdf/route';
import { GET as billingDocumentPdfGet } from '../billing-candidates/[id]/documents/pdf/route';
import { GET as managementPlanPdfGet } from '../management-plans/[id]/pdf/route';
import { GET as medicationHistoryPdfGet } from '../patients/[id]/medications/pdf/route';
import { GET as medicationCalendarPdfGet } from '../patients/[id]/medication-calendar/pdf/route';
import { GET as patientVisitRecordsPdfGet } from '../patients/[id]/visit-records/pdf/route';
import { GET as tracingReportPdfGet } from '../tracing-reports/[id]/pdf/route';
import { GET as visitRecordPdfGet } from '../visit-records/[id]/pdf/route';
import { GET as pharmacyInvoicePdfGet } from '../pharmacy-invoices/[id]/pdf/route';

function createRequest(url: string) {
  return new NextRequest(url, {
    headers: { 'x-org-id': 'org_1' },
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('PDF routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'admin',
      },
    });
    recordDataExportAuditMock.mockResolvedValue(undefined);
  });

  it('returns a care report pdf response', async () => {
    buildCareReportPdfMock.mockResolvedValue({
      buffer: Buffer.from('%PDF-care-report'),
      fileName: 'care-report.pdf',
      reportUpdatedAt: new Date('2026-03-28T09:00:00.000Z'),
    });

    const response = await careReportPdfGet(
      createRequest('http://localhost/api/care-reports/report_1/pdf'),
      {
        params: Promise.resolve({ id: 'report_1' }),
      },
    );

    expect(response).toBeDefined();
    if (!response) {
      throw new Error('Expected a response from care report pdf GET');
    }
    expect(buildCareReportPdfMock).toHaveBeenCalledWith('org_1', 'report_1', {
      userId: 'user_1',
      role: 'admin',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toContain('care-report.pdf');
  });

  it('returns a billing receipt pdf response', async () => {
    buildBillingDocumentPdfMock.mockResolvedValue({
      buffer: Buffer.from('%PDF-billing-receipt'),
      fileName: 'billing-receipt.pdf',
    });

    const response = await billingDocumentPdfGet(
      createRequest(
        'http://localhost/api/billing-candidates/candidate_1/documents/pdf?kind=receipt',
      ),
      {
        params: Promise.resolve({ id: 'candidate_1' }),
      },
    );

    expect(response).toBeDefined();
    if (!response) {
      throw new Error('Expected a response from billing document pdf GET');
    }
    expect(buildBillingDocumentPdfMock).toHaveBeenCalledWith('org_1', 'candidate_1', 'receipt');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toContain('billing-receipt.pdf');
    expectSensitiveNoStore(response);
  });

  it('returns a pharmacy invoice pdf response', async () => {
    buildPharmacyInvoiceDocumentPdfMock.mockResolvedValue({
      buffer: Buffer.from('%PDF-pharmacy-invoice'),
      fileName: 'pharmacy-invoice.pdf',
      auditMetadata: {
        document_kind: 'invoice',
        billing_month: '2026-06-01',
        status: 'draft',
        item_count: 1,
        subtotal: 5500,
        tax_amount: 550,
        total: 6050,
        patient_display_mode: 'management_number',
      },
    });

    const response = await pharmacyInvoicePdfGet(
      createRequest('http://localhost/api/pharmacy-invoices/invoice_1/pdf?purpose=monthly'),
      {
        params: Promise.resolve({ id: 'invoice_1' }),
      },
    );

    expect(response).toBeDefined();
    if (!response) {
      throw new Error('Expected a response from pharmacy invoice pdf GET');
    }
    expect(buildPharmacyInvoiceDocumentPdfMock).toHaveBeenCalledWith('org_1', 'invoice_1');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toContain('pharmacy-invoice.pdf');
  });

  it('returns a management plan pdf response', async () => {
    buildManagementPlanPdfMock.mockResolvedValue({
      buffer: Buffer.from('%PDF-management-plan'),
      fileName: 'management-plan.pdf',
    });

    const response = await managementPlanPdfGet(
      createRequest('http://localhost/api/management-plans/plan_1/pdf'),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    );

    expect(response).toBeDefined();
    if (!response) {
      throw new Error('Expected a response from management plan pdf GET');
    }
    expect(buildManagementPlanPdfMock).toHaveBeenCalledWith('org_1', 'plan_1', {
      userId: 'user_1',
      role: 'admin',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
  });

  it('returns a medication history pdf response', async () => {
    buildMedicationHistoryPdfMock.mockResolvedValue({
      buffer: Buffer.from('%PDF-medications'),
      fileName: 'medications.pdf',
    });

    const response = await medicationHistoryPdfGet(
      createRequest('http://localhost/api/patients/patient_1/medications/pdf'),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    expect(response).toBeDefined();
    if (!response) {
      throw new Error('Expected a response from medication history pdf GET');
    }
    expect(buildMedicationHistoryPdfMock).toHaveBeenCalledWith('org_1', 'patient_1', {
      userId: 'user_1',
      role: 'admin',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
  });

  it('passes the month query to the medication calendar pdf response', async () => {
    buildMedicationCalendarPdfMock.mockResolvedValue({
      buffer: Buffer.from('%PDF-calendar'),
      fileName: 'calendar.pdf',
    });

    const response = await medicationCalendarPdfGet(
      createRequest(
        'http://localhost/api/patients/patient_1/medication-calendar/pdf?month=2026-04',
      ),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    expect(response).toBeDefined();
    if (!response) {
      throw new Error('Expected a response from medication calendar pdf GET');
    }
    expect(buildMedicationCalendarPdfMock).toHaveBeenCalledWith('org_1', 'patient_1', '2026-04', {
      userId: 'user_1',
      role: 'admin',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
  });

  it('returns a tracing report pdf response', async () => {
    buildTracingReportPdfMock.mockResolvedValue({
      buffer: Buffer.from('%PDF-tracing'),
      fileName: 'tracing-report.pdf',
    });

    const response = await tracingReportPdfGet(
      createRequest('http://localhost/api/tracing-reports/tracing_1/pdf'),
      {
        params: Promise.resolve({ id: 'tracing_1' }),
      },
    );

    expect(response).toBeDefined();
    if (!response) {
      throw new Error('Expected a response from tracing report pdf GET');
    }
    expect(buildTracingReportPdfMock).toHaveBeenCalledWith('org_1', 'tracing_1', {
      userId: 'user_1',
      role: 'admin',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
  });

  it('returns a visit record pdf response', async () => {
    buildVisitRecordPdfMock.mockResolvedValue({
      buffer: Buffer.from('%PDF-visit-record'),
      fileName: 'visit-record.pdf',
    });

    const response = await visitRecordPdfGet(
      createRequest('http://localhost/api/visit-records/visit_1/pdf'),
      {
        params: Promise.resolve({ id: 'visit_1' }),
      },
    );

    expect(response).toBeDefined();
    if (!response) {
      throw new Error('Expected a response from visit record pdf GET');
    }
    expect(buildVisitRecordPdfMock).toHaveBeenCalledWith('org_1', 'visit_1', {
      userId: 'user_1',
      role: 'admin',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expectSensitiveNoStore(response);
  });

  it('passes date filters to the patient visit records pdf response', async () => {
    buildPatientVisitRecordsPdfMock.mockResolvedValue({
      buffer: Buffer.from('%PDF-patient-visits'),
      fileName: 'visit-records.pdf',
    });

    const response = await patientVisitRecordsPdfGet(
      createRequest(
        'http://localhost/api/patients/patient_1/visit-records/pdf?date_from=2026-03-01&date_to=2026-03-31',
      ),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    expect(response).toBeDefined();
    if (!response) {
      throw new Error('Expected a response from patient visit records pdf GET');
    }
    expect(buildPatientVisitRecordsPdfMock).toHaveBeenCalledWith(
      'org_1',
      'patient_1',
      '2026-03-01',
      '2026-03-31',
      {
        userId: 'user_1',
        role: 'admin',
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expectSensitiveNoStore(response);
  });

  it('maps pdf not found errors to 404', async () => {
    buildCareReportPdfMock.mockRejectedValue(new Error('報告書が見つかりません'));

    const response = await careReportPdfGet(
      createRequest('http://localhost/api/care-reports/missing/pdf'),
      {
        params: Promise.resolve({ id: 'missing' }),
      },
    );

    expect(response).toBeDefined();
    if (!response) {
      throw new Error('Expected a response from missing care report pdf GET');
    }
    expect(response.status).toBe(404);
  });
});
