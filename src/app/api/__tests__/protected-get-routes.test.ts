import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  prismaMock,
  withOrgContextMock,
  txMock,
  patientVisitBriefMock,
  scheduleVisitBriefMock,
  buildBillingDocumentPdfMock,
  buildPatientVisitRecordsPdfMock,
  buildVisitRecordPdfMock,
  buildPharmacyInvoiceDocumentPdfMock,
} = vi.hoisted(() => {
  const createRecord = () => ({
    id: 'entity_1',
    status: 'active',
    version: 1,
    overall_status: 'ready_to_dispense',
    cycle_id: 'cycle_1',
    line_id: 'line_1',
    patient_id: 'patient_1',
    case_id: 'case_1',
    case_: {
      patient_id: 'patient_1',
    },
    role: 'admin',
    _count: { id: 0 },
  });

  const createModel = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(createRecord()),
    count: vi.fn().mockResolvedValue(0),
    groupBy: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(createRecord()),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    create: vi.fn().mockResolvedValue(createRecord()),
    createMany: vi.fn().mockResolvedValue({ count: 1 }),
  });

  const createDbProxy = () => {
    const cache = new Map<PropertyKey, ReturnType<typeof createModel>>();
    return new Proxy(
      {},
      {
        get: (_target, prop: PropertyKey) => {
          if (!cache.has(prop)) {
            cache.set(prop, createModel());
          }
          return cache.get(prop);
        },
      },
    );
  };

  type DbProxy = Record<string, ReturnType<typeof createModel>>;

  return {
    authMock: vi.fn(),
    prismaMock: createDbProxy() as DbProxy,
    txMock: createDbProxy() as DbProxy,
    withOrgContextMock: vi.fn(),
    patientVisitBriefMock: vi.fn(),
    scheduleVisitBriefMock: vi.fn(),
    buildBillingDocumentPdfMock: vi.fn(),
    buildPatientVisitRecordsPdfMock: vi.fn(),
    buildVisitRecordPdfMock: vi.fn(),
    buildPharmacyInvoiceDocumentPdfMock: vi.fn(),
  };
});

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/visit-brief', () => ({
  getPatientVisitBrief: patientVisitBriefMock,
  getScheduleVisitBrief: scheduleVisitBriefMock,
}));

vi.mock('@/server/services/pdf-documents', () => ({
  buildBillingDocumentPdf: buildBillingDocumentPdfMock,
  buildPatientVisitRecordsPdf: buildPatientVisitRecordsPdfMock,
  buildVisitRecordPdf: buildVisitRecordPdfMock,
}));

vi.mock('@/server/services/pdf-pharmacy-invoice', () => ({
  buildPharmacyInvoiceDocumentPdf: buildPharmacyInvoiceDocumentPdfMock,
}));

import { GET as auditLogsGet } from '../audit-logs/route';
import { GET as auditLogsExportGet } from '../audit-logs/export/route';
import { GET as billingCandidatesGet } from '../billing-candidates/route';
import { GET as billingDocumentPdfGet } from '../billing-candidates/[id]/documents/pdf/route';
import { GET as billingCandidatesExportGet } from '../billing-candidates/export/route';
import { GET as businessHolidaysGet } from '../business-holidays/route';
import { GET as careReportsGet } from '../care-reports/route';
import { GET as careReportGet } from '../care-reports/[id]/route';
import { GET as casesGet } from '../cases/route';
import { GET as communicationEventsGet } from '../communication-events/route';
import { GET as communicationRequestsGet } from '../communication-requests/route';
import { GET as communicationRequestsExportGet } from '../communication-requests/export/route';
import { GET as conferenceNotesGet } from '../conference-notes/route';
import { GET as dashboardWorkflowGet } from '../dashboard/workflow/route';
import { GET as dashboardMedicationDeadlinesGet } from '../dashboard/medication-deadlines/route';
import { GET as dashboardMonthlyStatsGet } from '../dashboard/monthly-stats/route';
import { GET as dashboardOverdueGet } from '../dashboard/overdue/route';
import { GET as dispenseAuditsGet } from '../dispense-audits/route';
import { GET as dispenseQueueGet } from '../dispense-queue/route';
import { GET as inquiryRecordsGet } from '../inquiry-records/route';
import { GET as medicationIssuesGet } from '../medication-issues/route';
import { GET as medicationProfilesGet } from '../medication-profiles/route';
import { GET as patientsGet } from '../patients/route';
import { GET as patientGet } from '../patients/[id]/route';
import { GET as patientVisitBriefGet } from '../patients/[id]/visit-brief/route';
import { GET as patientVisitRecordsPdfGet } from '../patients/[id]/visit-records/pdf/route';
import { GET as pharmacistsGet } from '../pharmacists/route';
import { GET as pharmacistShiftsGet } from '../pharmacist-shifts/route';
import { GET as pharmacistShiftsAvailableGet } from '../pharmacist-shifts/available/route';
import { GET as pharmacyInvoicePdfGet } from '../pharmacy-invoices/[id]/pdf/route';
import { GET as pharmacySitesGet } from '../pharmacy-sites/route';
import { GET as prescriptionIntakesGet } from '../prescription-intakes/route';
import { GET as prescriptionIntakeGet } from '../prescription-intakes/[id]/route';
import { GET as residualMedicationsGet } from '../residual-medications/route';
import { GET as setPlansGet } from '../set-plans/route';
import { GET as tracingReportsGet } from '../tracing-reports/route';
import { GET as visitRecordsGet } from '../visit-records/route';
import { GET as visitRecordGet } from '../visit-records/[id]/route';
import { GET as visitRecordPdfGet } from '../visit-records/[id]/pdf/route';
import { GET as visitScheduleProposalsGet } from '../visit-schedule-proposals/route';
import { GET as visitSchedulesGet } from '../visit-schedules/route';
import { GET as visitScheduleGet } from '../visit-schedules/[id]/route';
import { GET as visitPreparationBriefGet } from '../visit-preparations/[scheduleId]/brief/route';

type Handler = () => Promise<Response | undefined>;
const emptyRouteContext = { params: Promise.resolve({}) };

function createRequest(url: string, headers?: Record<string, string>) {
  return new NextRequest(url, { headers });
}

const routes: Array<{ name: string; handler: Handler }> = [
  {
    name: 'audit-logs GET',
    handler: () =>
      auditLogsGet(
        createRequest('http://localhost/api/audit-logs', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'audit-logs/export GET',
    handler: () =>
      auditLogsExportGet(
        createRequest('http://localhost/api/audit-logs/export', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'billing-candidates GET',
    handler: () =>
      billingCandidatesGet(
        createRequest('http://localhost/api/billing-candidates', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'billing-candidates/export GET',
    handler: () => {
      txMock.billingCandidate.findMany.mockResolvedValueOnce([
        {
          id: 'candidate_1',
          patient_id: 'patient_1',
          billing_domain: 'home_care',
          billing_target_type: 'patient',
          billing_target_id: null,
          billing_target_name: null,
          cycle_id: null,
          billing_month: new Date('2026-03-01T00:00:00.000Z'),
          billing_code: 'HC001',
          billing_name: '在宅訪問管理',
          points: 100,
          calculation_breakdown: {},
          status: 'confirmed',
          source_snapshot: {},
        },
      ]);
      return billingCandidatesExportGet(
        createRequest('http://localhost/api/billing-candidates/export', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      );
    },
  },
  {
    name: 'billing-candidates/[id]/documents/pdf GET',
    handler: () =>
      billingDocumentPdfGet(
        createRequest(
          'http://localhost/api/billing-candidates/candidate_1/documents/pdf?kind=receipt',
          {
            'x-org-id': 'org_1',
          },
        ),
        { params: Promise.resolve({ id: 'candidate_1' }) },
      ),
  },
  {
    name: 'pharmacy-invoices/[id]/pdf GET',
    handler: () =>
      pharmacyInvoicePdfGet(
        createRequest('http://localhost/api/pharmacy-invoices/invoice_1/pdf?purpose=monthly', {
          'x-org-id': 'org_1',
        }),
        { params: Promise.resolve({ id: 'invoice_1' }) },
      ),
  },
  {
    name: 'business-holidays GET',
    handler: () =>
      businessHolidaysGet(
        createRequest('http://localhost/api/business-holidays', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'care-reports GET',
    handler: () =>
      careReportsGet(
        createRequest('http://localhost/api/care-reports', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'care-reports/[id] GET',
    handler: () =>
      careReportGet(
        createRequest('http://localhost/api/care-reports/report_1', { 'x-org-id': 'org_1' }),
        { params: Promise.resolve({ id: 'report_1' }) },
      ),
  },
  {
    name: 'cases GET',
    handler: () =>
      casesGet(
        createRequest('http://localhost/api/cases', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'communication-events GET',
    handler: () =>
      communicationEventsGet(
        createRequest('http://localhost/api/communication-events', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'communication-requests GET',
    handler: () =>
      communicationRequestsGet(
        createRequest('http://localhost/api/communication-requests', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'communication-requests/export GET',
    handler: () =>
      communicationRequestsExportGet(
        createRequest('http://localhost/api/communication-requests/export', {
          'x-org-id': 'org_1',
        }),
        emptyRouteContext,
      ),
  },
  {
    name: 'conference-notes GET',
    handler: () =>
      conferenceNotesGet(
        createRequest('http://localhost/api/conference-notes', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'dashboard/workflow GET',
    handler: () =>
      dashboardWorkflowGet(
        createRequest('http://localhost/api/dashboard/workflow', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'dashboard/overdue GET',
    handler: () =>
      dashboardOverdueGet(
        createRequest('http://localhost/api/dashboard/overdue', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'dashboard/monthly-stats GET',
    handler: () =>
      dashboardMonthlyStatsGet(
        createRequest('http://localhost/api/dashboard/monthly-stats?month=2026-03', {
          'x-org-id': 'org_1',
        }),
        emptyRouteContext,
      ),
  },
  {
    name: 'dashboard/medication-deadlines GET',
    handler: () =>
      dashboardMedicationDeadlinesGet(
        createRequest('http://localhost/api/dashboard/medication-deadlines', {
          'x-org-id': 'org_1',
        }),
        emptyRouteContext,
      ),
  },
  {
    name: 'dispense-audits GET',
    handler: () =>
      dispenseAuditsGet(
        createRequest('http://localhost/api/dispense-audits', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'dispense-queue GET',
    handler: () =>
      dispenseQueueGet(
        createRequest('http://localhost/api/dispense-queue', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'inquiry-records GET',
    handler: () =>
      inquiryRecordsGet(
        createRequest('http://localhost/api/inquiry-records', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'medication-issues GET',
    handler: () =>
      medicationIssuesGet(
        createRequest('http://localhost/api/medication-issues', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'medication-profiles GET',
    handler: () =>
      medicationProfilesGet(
        createRequest('http://localhost/api/medication-profiles', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'patients GET',
    handler: () =>
      patientsGet(
        createRequest('http://localhost/api/patients', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'patients/[id] GET',
    handler: () =>
      patientGet(
        createRequest('http://localhost/api/patients/patient_1', { 'x-org-id': 'org_1' }),
        { params: Promise.resolve({ id: 'patient_1' }) },
      ),
  },
  {
    name: 'patients/[id]/visit-brief GET',
    handler: () =>
      patientVisitBriefGet(
        createRequest('http://localhost/api/patients/patient_1/visit-brief', {
          'x-org-id': 'org_1',
        }),
        { params: Promise.resolve({ id: 'patient_1' }) },
      ),
  },
  {
    name: 'patients/[id]/visit-records/pdf GET',
    handler: () =>
      patientVisitRecordsPdfGet(
        createRequest('http://localhost/api/patients/patient_1/visit-records/pdf', {
          'x-org-id': 'org_1',
        }),
        { params: Promise.resolve({ id: 'patient_1' }) },
      ),
  },
  {
    name: 'pharmacists GET',
    handler: () =>
      pharmacistsGet(
        createRequest('http://localhost/api/pharmacists', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'pharmacist-shifts GET',
    handler: () =>
      pharmacistShiftsGet(
        createRequest('http://localhost/api/pharmacist-shifts', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'pharmacist-shifts/available GET',
    handler: () =>
      pharmacistShiftsAvailableGet(
        createRequest('http://localhost/api/pharmacist-shifts/available?date=2026-03-26', {
          'x-org-id': 'org_1',
        }),
        emptyRouteContext,
      ),
  },
  {
    name: 'pharmacy-sites GET',
    handler: () =>
      pharmacySitesGet(
        createRequest('http://localhost/api/pharmacy-sites', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'prescription-intakes GET',
    handler: () =>
      prescriptionIntakesGet(
        createRequest('http://localhost/api/prescription-intakes', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'prescription-intakes/[id] GET',
    handler: () =>
      prescriptionIntakeGet(
        createRequest('http://localhost/api/prescription-intakes/intake_1', {
          'x-org-id': 'org_1',
        }),
        { params: Promise.resolve({ id: 'intake_1' }) },
      ),
  },
  {
    name: 'residual-medications GET',
    handler: () =>
      residualMedicationsGet(
        createRequest('http://localhost/api/residual-medications', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'set-plans GET',
    handler: () =>
      setPlansGet(
        createRequest('http://localhost/api/set-plans', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'tracing-reports GET',
    handler: () =>
      tracingReportsGet(
        createRequest('http://localhost/api/tracing-reports', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'visit-records GET',
    handler: () =>
      visitRecordsGet(
        createRequest('http://localhost/api/visit-records', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'visit-records/[id] GET',
    handler: () =>
      visitRecordGet(
        createRequest('http://localhost/api/visit-records/record_1', { 'x-org-id': 'org_1' }),
        { params: Promise.resolve({ id: 'record_1' }) },
      ),
  },
  {
    name: 'visit-records/[id]/pdf GET',
    handler: () =>
      visitRecordPdfGet(
        createRequest('http://localhost/api/visit-records/record_1/pdf', { 'x-org-id': 'org_1' }),
        { params: Promise.resolve({ id: 'record_1' }) },
      ),
  },
  {
    name: 'visit-schedule-proposals GET',
    handler: () =>
      visitScheduleProposalsGet(
        createRequest('http://localhost/api/visit-schedule-proposals', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'visit-schedules GET',
    handler: () =>
      visitSchedulesGet(
        createRequest('http://localhost/api/visit-schedules', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'visit-schedules/[id] GET',
    handler: () =>
      visitScheduleGet(
        createRequest('http://localhost/api/visit-schedules/schedule_1', { 'x-org-id': 'org_1' }),
        { params: Promise.resolve({ id: 'schedule_1' }) },
      ),
  },
  {
    name: 'visit-preparations/[scheduleId]/brief GET',
    handler: () =>
      visitPreparationBriefGet(
        createRequest('http://localhost/api/visit-preparations/schedule_1/brief', {
          'x-org-id': 'org_1',
        }),
        { params: Promise.resolve({ scheduleId: 'schedule_1' }) },
      ),
  },
];

describe('protected GET routes auth matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientVisitBriefMock.mockResolvedValue({
      patient: { id: 'patient_1', name: '患者A' },
      context: 'patient',
      generated_at: '2026-03-27T00:00:00.000Z',
      last_prescribed_date: null,
      medication_changes: [],
      medications: [],
      dispensing_items: [],
      multidisciplinary_updates: [],
      unresolved_items: [],
      must_check_today: [],
      ai_summary: {
        provider: 'rule',
        is_fallback: true,
        headline: '要点なし',
        bullets: [],
        must_check_today: [],
        source_refs: [],
        generated_at: '2026-03-27T00:00:00.000Z',
      },
    });
    scheduleVisitBriefMock.mockResolvedValue({
      patient: { id: 'patient_1', name: '患者A' },
      context: 'schedule',
      generated_at: '2026-03-27T00:00:00.000Z',
      last_prescribed_date: null,
      medication_changes: [],
      medications: [],
      dispensing_items: [],
      multidisciplinary_updates: [],
      unresolved_items: [],
      must_check_today: [],
      ai_summary: {
        provider: 'rule',
        is_fallback: true,
        headline: '要点なし',
        bullets: [],
        must_check_today: [],
        source_refs: [],
        generated_at: '2026-03-27T00:00:00.000Z',
      },
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(txMock));
    buildBillingDocumentPdfMock.mockResolvedValue({
      buffer: Buffer.from('%PDF-billing-receipt'),
      fileName: 'billing-receipt.pdf',
    });
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
    buildPatientVisitRecordsPdfMock.mockResolvedValue({
      buffer: Buffer.from('%PDF-patient-visits'),
      fileName: 'visit-records.pdf',
    });
    buildVisitRecordPdfMock.mockResolvedValue({
      buffer: Buffer.from('%PDF-visit-record'),
      fileName: 'visit-record.pdf',
    });
  });

  for (const route of routes) {
    it(`${route.name} returns 401 when unauthenticated`, async () => {
      authMock.mockResolvedValue(null);

      const response = await route.handler();

      expect(response).toBeDefined();
      if (!response) throw new Error('response is required');
      expect(response.status).toBe(401);
    });

    it(`${route.name} returns 403 when role lacks permission`, async () => {
      authMock.mockResolvedValue({ user: { id: 'user_1' } });
      prismaMock.membership.findFirst.mockResolvedValue({ role: 'driver' });

      const response = await route.handler();

      expect(response).toBeDefined();
      if (!response) throw new Error('response is required');
      expect(response.status).toBe(403);
    });

    it(`${route.name} returns 200 when role has permission`, async () => {
      authMock.mockResolvedValue({ user: { id: 'user_1' } });
      prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });

      const response = await route.handler();

      expect(response).toBeDefined();
      if (!response) throw new Error('response is required');
      expect(response.status).toBe(200);
    });
  }
});
