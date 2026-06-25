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
  getPatientOverviewMock,
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
    structured_soap: {
      handoff: {
        next_check_items: ['確認事項'],
        ongoing_monitoring: [],
      },
    },
    schedule: {
      pharmacist_id: 'user_1',
      case_: {
        primary_pharmacist_id: 'user_1',
        backup_pharmacist_id: null,
      },
    },
    case_: {
      patient_id: 'patient_1',
    },
    role: 'admin',
    _count: { id: 0 },
    retry_count: 0,
    last_attempted_at: null,
    last_succeeded_at: null,
    last_failed_at: null,
    error_message: null,
    retryable: false,
    source_visit_record_version: 1,
    source_visit_record_updated_at: new Date('2026-06-18T00:00:00.000Z'),
  });

  const createModel = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(createRecord()),
    findUnique: vi.fn().mockResolvedValue(createRecord()),
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
    getPatientOverviewMock: vi.fn(),
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

vi.mock('@/server/services/patient-detail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/services/patient-detail')>();

  return {
    ...actual,
    getPatientOverview: getPatientOverviewMock,
  };
});

import { GET as auditLogsGet } from '../audit-logs/route';
import { GET as auditLogsExportGet } from '../audit-logs/export/route';
import { GET as billingCandidatesGet } from '../billing-candidates/route';
import { GET as billingDocumentPdfGet } from '../billing-candidates/[id]/documents/pdf/route';
import { GET as billingCandidatesExportGet } from '../billing-candidates/export/route';
import { GET as businessHolidaysGet } from '../business-holidays/route';
import { GET as careReportsGet } from '../care-reports/route';
import { GET as careReportGet } from '../care-reports/[id]/route';
import { GET as careReportsAnalyticsGet } from '../care-reports/analytics/route';
import { GET as casesGet } from '../cases/route';
import { GET as communicationEventsGet } from '../communication-events/route';
import { GET as communicationRequestsGet } from '../communication-requests/route';
import { GET as communicationRequestsExportGet } from '../communication-requests/export/route';
import { GET as conferenceNotesGet } from '../conference-notes/route';
import { GET as dashboardClerkSupportGet } from '../dashboard/clerk-support/route';
import { GET as dashboardCockpitGet } from '../dashboard/cockpit/route';
import { GET as dashboardDispensingStatsGet } from '../dashboard/dispensing-stats/route';
import { GET as dashboardWorkflowGet } from '../dashboard/workflow/route';
import { GET as dashboardMedicationDeadlinesGet } from '../dashboard/medication-deadlines/route';
import { GET as dashboardMonthlyStatsGet } from '../dashboard/monthly-stats/route';
import { GET as dashboardOverdueGet } from '../dashboard/overdue/route';
import { GET as dispenseAuditsGet } from '../dispense-audits/route';
import { GET as dispenseQueueGet } from '../dispense-queue/route';
import { GET as dispenseTasksGet } from '../dispense-tasks/route';
import { GET as dispenseTaskWorkbenchGet } from '../dispense-tasks/[id]/workbench/route';
import { GET as firstVisitDocumentsGet } from '../first-visit-documents/route';
import { GET as inquiryRecordsGet } from '../inquiry-records/route';
import { GET as interventionsGet } from '../interventions/route';
import { GET as managementPlansGet } from '../management-plans/route';
import { GET as managementPlanGet } from '../management-plans/[id]/route';
import { GET as medicationCyclesGet } from '../medication-cycles/route';
import { GET as medicationIssuesGet } from '../medication-issues/route';
import { GET as medicationProfilesGet } from '../medication-profiles/route';
import { GET as patientsGet } from '../patients/route';
import { GET as patientsBoardGet } from '../patients/board/route';
import { GET as patientCheckDuplicateGet } from '../patients/check-duplicate/route';
import { GET as patientGet } from '../patients/[id]/route';
import { GET as patientOverviewGet } from '../patients/[id]/overview/route';
import { GET as patientPrescriptionsGet } from '../patients/[id]/prescriptions/route';
import { GET as patientSelfReportsGet } from '../patient-self-reports/route';
import { GET as patientSelfReportGet } from '../patient-self-reports/[id]/route';
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
import { GET as staffWorkloadGet } from '../staff-workload/route';
import { GET as tasksGet } from '../tasks/route';
import { GET as tracingReportsGet } from '../tracing-reports/route';
import { GET as visitRecordsGet } from '../visit-records/route';
import { GET as visitRecordGet } from '../visit-records/[id]/route';
import { GET as visitRecordHandoffGet } from '../visit-records/[id]/handoff/route';
import { GET as visitRecordPdfGet } from '../visit-records/[id]/pdf/route';
import { GET as visitRecordReflectedFieldsGet } from '../visit-records/[id]/reflected-fields/route';
import { GET as visitScheduleProposalsGet } from '../visit-schedule-proposals/route';
import { GET as visitSchedulesGet } from '../visit-schedules/route';
import { GET as visitScheduleGet } from '../visit-schedules/[id]/route';
import { GET as visitSchedulesDayBoardGet } from '../visit-schedules/day-board/route';
import { GET as visitsTodayPreparationGet } from '../visits/today-preparation/route';
import { GET as visitPreparationBriefGet } from '../visit-preparations/[scheduleId]/brief/route';

type Handler = () => Promise<Response | undefined>;
const emptyRouteContext = { params: Promise.resolve({}) };

function createRequest(url: string, headers?: Record<string, string>) {
  return new NextRequest(url, { headers });
}

const routes: Array<{ name: string; handler: Handler; setupSuccess?: () => void }> = [
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
    name: 'care-reports/analytics GET',
    handler: () =>
      careReportsAnalyticsGet(
        createRequest('http://localhost/api/care-reports/analytics?overdue_days=7', {
          'x-org-id': 'org_1',
        }),
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
    name: 'dashboard/clerk-support GET',
    handler: () =>
      dashboardClerkSupportGet(
        createRequest('http://localhost/api/dashboard/clerk-support', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'dashboard/cockpit GET',
    handler: () =>
      dashboardCockpitGet(
        createRequest('http://localhost/api/dashboard/cockpit', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'dashboard/dispensing-stats GET',
    handler: () =>
      dashboardDispensingStatsGet(
        createRequest('http://localhost/api/dashboard/dispensing-stats', { 'x-org-id': 'org_1' }),
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
    name: 'dispense-tasks GET',
    handler: () =>
      dispenseTasksGet(
        createRequest('http://localhost/api/dispense-tasks', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'dispense-tasks/[id]/workbench GET',
    setupSuccess: () => {
      prismaMock.patientLabObservation.findFirst.mockResolvedValueOnce(null);
      prismaMock.visitSchedule.findFirst.mockResolvedValueOnce(null);
      prismaMock.dispenseTask.count.mockResolvedValueOnce(0);
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce(null);
      prismaMock.dispenseTask.findFirst.mockResolvedValueOnce({
        id: 'task_1',
        status: 'pending',
        priority: 'normal',
        due_date: null,
        results: [],
        cycle: {
          id: 'cycle_1',
          overall_status: 'ready_to_dispense',
          version: 1,
          case_id: 'case_1',
          case_: {
            id: 'case_1',
            patient: {
              id: 'patient_1',
              name: '患者A',
              allergy_info: null,
              scheduling_preference: null,
              conditions: [],
            },
          },
          inquiries: [],
          packaging_groups: [],
          prescription_intakes: [],
        },
      });
    },
    handler: () =>
      dispenseTaskWorkbenchGet(
        createRequest('http://localhost/api/dispense-tasks/task_1/workbench', {
          'x-org-id': 'org_1',
        }),
        { params: Promise.resolve({ id: 'task_1' }) },
      ),
  },
  {
    name: 'first-visit-documents GET',
    handler: () =>
      firstVisitDocumentsGet(
        createRequest('http://localhost/api/first-visit-documents', { 'x-org-id': 'org_1' }),
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
    name: 'interventions GET',
    handler: () =>
      interventionsGet(
        createRequest('http://localhost/api/interventions', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'management-plans GET',
    handler: () =>
      managementPlansGet(
        createRequest('http://localhost/api/management-plans?case_id=case_1', {
          'x-org-id': 'org_1',
        }),
      ),
  },
  {
    name: 'management-plans/[id] GET',
    handler: () =>
      managementPlanGet(
        createRequest('http://localhost/api/management-plans/plan_1', { 'x-org-id': 'org_1' }),
        { params: Promise.resolve({ id: 'plan_1' }) },
      ),
  },
  {
    name: 'medication-cycles GET',
    handler: () =>
      medicationCyclesGet(
        createRequest('http://localhost/api/medication-cycles', { 'x-org-id': 'org_1' }),
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
    name: 'patients/board GET',
    handler: () =>
      patientsBoardGet(
        createRequest('http://localhost/api/patients/board?scope=all', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'patients/check-duplicate GET',
    handler: () =>
      patientCheckDuplicateGet(
        createRequest(
          'http://localhost/api/patients/check-duplicate?name=%E5%B1%B1%E7%94%B0&date_of_birth=1950-01-01&gender=male',
          { 'x-org-id': 'org_1' },
        ),
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
    name: 'patients/[id]/overview GET',
    setupSuccess: () => {
      getPatientOverviewMock.mockResolvedValueOnce({ id: 'patient_1', name: '患者A' });
    },
    handler: () =>
      patientOverviewGet(
        createRequest('http://localhost/api/patients/patient_1/overview', {
          'x-org-id': 'org_1',
        }),
        { params: Promise.resolve({ id: 'patient_1' }) },
      ),
  },
  {
    name: 'patients/[id]/prescriptions GET',
    handler: () =>
      patientPrescriptionsGet(
        createRequest('http://localhost/api/patients/patient_1/prescriptions?limit=5', {
          'x-org-id': 'org_1',
        }),
        { params: Promise.resolve({ id: 'patient_1' }) },
      ),
  },
  {
    name: 'patient-self-reports GET',
    handler: () =>
      patientSelfReportsGet(
        createRequest('http://localhost/api/patient-self-reports', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'patient-self-reports/[id] GET',
    handler: () =>
      patientSelfReportGet(
        createRequest('http://localhost/api/patient-self-reports/report_1', {
          'x-org-id': 'org_1',
        }),
        { params: Promise.resolve({ id: 'report_1' }) },
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
    name: 'staff-workload GET',
    handler: () =>
      staffWorkloadGet(
        createRequest('http://localhost/api/staff-workload?date=2026-06-12', {
          'x-org-id': 'org_1',
        }),
      ),
  },
  {
    name: 'tasks GET',
    handler: () => tasksGet(createRequest('http://localhost/api/tasks', { 'x-org-id': 'org_1' })),
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
    name: 'visit-records/[id]/handoff GET',
    handler: () =>
      visitRecordHandoffGet(
        createRequest('http://localhost/api/visit-records/record_1/handoff', {
          'x-org-id': 'org_1',
        }),
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
    name: 'visit-records/[id]/reflected-fields GET',
    handler: () =>
      visitRecordReflectedFieldsGet(
        createRequest('http://localhost/api/visit-records/record_1/reflected-fields', {
          'x-org-id': 'org_1',
        }),
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
    name: 'visit-schedules/day-board GET',
    handler: () =>
      visitSchedulesDayBoardGet(
        createRequest('http://localhost/api/visit-schedules/day-board?date=2026-06-12', {
          'x-org-id': 'org_1',
        }),
        emptyRouteContext,
      ),
  },
  {
    name: 'visits/today-preparation GET',
    handler: () =>
      visitsTodayPreparationGet(
        createRequest('http://localhost/api/visits/today-preparation', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
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
      if (
        route.name === 'prescription-intakes GET' ||
        route.name === 'medication-cycles GET' ||
        route.name === 'billing-candidates GET' ||
        route.name === 'billing-candidates/export GET' ||
        route.name === 'dispense-tasks GET' ||
        route.name === 'dispense-tasks/[id]/workbench GET' ||
        route.name === 'tasks GET' ||
        route.name === 'patients GET' ||
        route.name === 'patients/board GET' ||
        route.name === 'patients/check-duplicate GET' ||
        route.name === 'patients/[id]/overview GET' ||
        route.name === 'patients/[id]/prescriptions GET' ||
        route.name === 'first-visit-documents GET' ||
        route.name === 'care-reports/analytics GET' ||
        route.name === 'cases GET' ||
        route.name === 'management-plans GET' ||
        route.name === 'management-plans/[id] GET' ||
        route.name === 'visit-records/[id] GET' ||
        route.name === 'visit-schedules/day-board GET' ||
        route.name === 'visits/today-preparation GET' ||
        route.name === 'visit-schedule-proposals GET' ||
        route.name === 'set-plans GET' ||
        route.name === 'staff-workload GET' ||
        route.name === 'dashboard/clerk-support GET' ||
        route.name === 'dashboard/cockpit GET' ||
        route.name === 'dashboard/dispensing-stats GET' ||
        route.name === 'dashboard/workflow GET' ||
        route.name === 'dashboard/overdue GET' ||
        route.name === 'dashboard/medication-deadlines GET' ||
        route.name === 'dashboard/monthly-stats GET'
      ) {
        expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
        expect(response.headers.get('Pragma')).toBe('no-cache');
      }
    });

    it(`${route.name} returns 403 when role lacks permission`, async () => {
      authMock.mockResolvedValue({ user: { id: 'user_1' } });
      prismaMock.membership.findFirst.mockResolvedValue({ role: 'driver' });

      const response = await route.handler();

      expect(response).toBeDefined();
      if (!response) throw new Error('response is required');
      expect(response.status).toBe(403);
      if (
        route.name === 'prescription-intakes GET' ||
        route.name === 'medication-cycles GET' ||
        route.name === 'billing-candidates GET' ||
        route.name === 'billing-candidates/export GET' ||
        route.name === 'dispense-tasks GET' ||
        route.name === 'dispense-tasks/[id]/workbench GET' ||
        route.name === 'tasks GET' ||
        route.name === 'patients GET' ||
        route.name === 'patients/board GET' ||
        route.name === 'patients/check-duplicate GET' ||
        route.name === 'patients/[id]/overview GET' ||
        route.name === 'patients/[id]/prescriptions GET' ||
        route.name === 'first-visit-documents GET' ||
        route.name === 'care-reports/analytics GET' ||
        route.name === 'cases GET' ||
        route.name === 'management-plans GET' ||
        route.name === 'management-plans/[id] GET' ||
        route.name === 'visit-records/[id] GET' ||
        route.name === 'visit-schedules/day-board GET' ||
        route.name === 'visits/today-preparation GET' ||
        route.name === 'visit-schedule-proposals GET' ||
        route.name === 'set-plans GET' ||
        route.name === 'staff-workload GET' ||
        route.name === 'dashboard/clerk-support GET' ||
        route.name === 'dashboard/cockpit GET' ||
        route.name === 'dashboard/dispensing-stats GET' ||
        route.name === 'dashboard/workflow GET' ||
        route.name === 'dashboard/overdue GET' ||
        route.name === 'dashboard/medication-deadlines GET' ||
        route.name === 'dashboard/monthly-stats GET'
      ) {
        expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
        expect(response.headers.get('Pragma')).toBe('no-cache');
      }
    });

    it(`${route.name} returns 200 when role has permission`, async () => {
      authMock.mockResolvedValue({ user: { id: 'user_1' } });
      prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
      route.setupSuccess?.();

      const response = await route.handler();

      expect(response).toBeDefined();
      if (!response) throw new Error('response is required');
      expect(response.status).toBe(200);
    });
  }
});
