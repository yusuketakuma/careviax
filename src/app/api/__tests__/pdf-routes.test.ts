import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  expectPhiExportSnapshotRedacted,
  expectSensitiveNoStore,
} from '@/test/api-response-assertions';

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
  pdfResponseCallMock,
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
  pdfResponseCallMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
  withAuthContext:
    (
      handler: (
        req: NextRequest,
        ctx: {
          userId: string;
          orgId: string;
          role: string;
          requestId: string;
          correlationId: string;
        },
        routeContext: { params: Promise<Record<string, string>> },
      ) => Promise<Response>,
      options: unknown,
    ) =>
    async (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) => {
      const authResult = await requireAuthContextMock(req, options);
      if ('response' in authResult) return authResult.response;
      const response = await handler(req, authResult.ctx, routeContext);
      response.headers.set('Cache-Control', 'private, no-store, max-age=0');
      response.headers.set('Pragma', 'no-cache');
      response.headers.set('X-Request-Id', authResult.ctx.requestId);
      response.headers.set('X-Correlation-Id', authResult.ctx.correlationId);
      return response;
    },
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

vi.mock('@/lib/api/pdf-response', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/pdf-response')>();
  return {
    ...actual,
    pdfResponse: (buffer: Buffer, fileName: string) => {
      pdfResponseCallMock(buffer, fileName);
      return actual.pdfResponse(buffer, fileName);
    },
  };
});

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

import { PdfNotFoundError } from '@/server/services/pdf-errors';
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

describe('PDF routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'admin',
        requestId: 'request_pdf_routes_1',
        correlationId: 'correlation_pdf_routes_1',
      },
    });
    recordDataExportAuditMock.mockResolvedValue(undefined);
  });

  it('awaits export audit before constructing every audited PDF response', async () => {
    const cases = [
      {
        name: 'management plan',
        setup: () =>
          buildManagementPlanPdfMock.mockResolvedValue({
            buffer: Buffer.from('%PDF-management-plan'),
            fileName: 'management-plan.pdf',
          }),
        invoke: () =>
          managementPlanPdfGet(createRequest('http://localhost/api/management-plans/plan_1/pdf'), {
            params: Promise.resolve({ id: 'plan_1' }),
          }),
      },
      {
        name: 'medication history',
        setup: () =>
          buildMedicationHistoryPdfMock.mockResolvedValue({
            buffer: Buffer.from('%PDF-medication-history'),
            fileName: 'medications.pdf',
          }),
        invoke: () =>
          medicationHistoryPdfGet(
            createRequest('http://localhost/api/patients/patient_1/medications/pdf'),
            { params: Promise.resolve({ id: 'patient_1' }) },
          ),
      },
      {
        name: 'medication calendar',
        setup: () =>
          buildMedicationCalendarPdfMock.mockResolvedValue({
            buffer: Buffer.from('%PDF-medication-calendar'),
            fileName: 'medication-calendar.pdf',
          }),
        invoke: () =>
          medicationCalendarPdfGet(
            createRequest(
              'http://localhost/api/patients/patient_1/medication-calendar/pdf?month=2026-03',
            ),
            { params: Promise.resolve({ id: 'patient_1' }) },
          ),
      },
      {
        name: 'patient visit record list',
        setup: () =>
          buildPatientVisitRecordsPdfMock.mockResolvedValue({
            buffer: Buffer.from('%PDF-patient-visits'),
            fileName: 'visit-records.pdf',
          }),
        invoke: () =>
          patientVisitRecordsPdfGet(
            createRequest('http://localhost/api/patients/patient_1/visit-records/pdf'),
            { params: Promise.resolve({ id: 'patient_1' }) },
          ),
      },
      {
        name: 'tracing report',
        setup: () =>
          buildTracingReportPdfMock.mockResolvedValue({
            buffer: Buffer.from('%PDF-tracing-report'),
            fileName: 'tracing-report.pdf',
          }),
        invoke: () =>
          tracingReportPdfGet(createRequest('http://localhost/api/tracing-reports/tracing_1/pdf'), {
            params: Promise.resolve({ id: 'tracing_1' }),
          }),
      },
      {
        name: 'visit record',
        setup: () =>
          buildVisitRecordPdfMock.mockResolvedValue({
            buffer: Buffer.from('%PDF-visit-record'),
            fileName: 'visit-record.pdf',
          }),
        invoke: () =>
          visitRecordPdfGet(createRequest('http://localhost/api/visit-records/visit_1/pdf'), {
            params: Promise.resolve({ id: 'visit_1' }),
          }),
      },
      {
        name: 'pharmacy invoice',
        setup: () =>
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
          }),
        invoke: () =>
          pharmacyInvoicePdfGet(
            createRequest(
              'http://localhost/api/pharmacy-invoices/invoice_1/pdf?purpose=partner_cooperation_monthly_pdf',
            ),
            { params: Promise.resolve({ id: 'invoice_1' }) },
          ),
      },
    ];

    for (const testCase of cases) {
      pdfResponseCallMock.mockClear();
      recordDataExportAuditMock.mockReset();
      testCase.setup();

      let resolveAudit!: () => void;
      recordDataExportAuditMock.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveAudit = resolve;
          }),
      );

      const responsePromise = testCase.invoke();
      await vi.waitFor(() => expect(recordDataExportAuditMock).toHaveBeenCalledTimes(1));
      expect(pdfResponseCallMock, testCase.name).not.toHaveBeenCalled();

      resolveAudit();
      const response = await responsePromise;
      expect(response.status, testCase.name).toBe(200);
      expect(pdfResponseCallMock, testCase.name).toHaveBeenCalledTimes(1);
    }
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

  it('keeps PHI-like builder filenames out of PDF response headers', async () => {
    buildCareReportPdfMock.mockResolvedValue({
      buffer: Buffer.from('%PDF-care-report'),
      fileName:
        'Taro Yamada 090-1234-5678 アムロジピン storageKey=s3 token=secret provider raw error.pdf',
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
    const disposition = response.headers.get('content-disposition') ?? '';
    expect(disposition).toBe(`inline; filename="document.pdf"; filename*=UTF-8''document.pdf`);
    expectPhiExportSnapshotRedacted(disposition, ['Taro', 'Yamada']);
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
      createRequest(
        'http://localhost/api/pharmacy-invoices/invoice_1/pdf?purpose=partner_cooperation_monthly_pdf',
      ),
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
    buildCareReportPdfMock.mockRejectedValue(new PdfNotFoundError('careReport'));

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

  it('does not map raw not-found-like pdf errors to 404', async () => {
    buildCareReportPdfMock.mockRejectedValue(
      new Error('報告書が見つかりません: patient 山田 太郎 token aggregate_pdf_secret'),
    );

    const response = await careReportPdfGet(
      createRequest('http://localhost/api/care-reports/missing/pdf'),
      {
        params: Promise.resolve({ id: 'missing' }),
      },
    );

    expect(response).toBeDefined();
    if (!response) {
      throw new Error('Expected a response from raw-error care report pdf GET');
    }
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain('EXTERNAL_PDF_RENDER_FAILED');
    expect(body).not.toContain('山田');
    expect(body).not.toContain('aggregate_pdf_secret');
  });
});
