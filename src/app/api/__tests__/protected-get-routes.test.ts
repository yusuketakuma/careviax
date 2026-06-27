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
  getPatientHeaderSummaryMock,
  getPatientOverviewMock,
  listBillingEvidenceBlockersMock,
  patientHomeCareFeatureSummaryMock,
  scheduleFeatureHighlightsMock,
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
    getPatientHeaderSummaryMock: vi.fn(),
    getPatientOverviewMock: vi.fn(),
    listBillingEvidenceBlockersMock: vi.fn(),
    patientHomeCareFeatureSummaryMock: vi.fn(),
    scheduleFeatureHighlightsMock: vi.fn(),
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

vi.mock('@/server/services/billing-evidence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/services/billing-evidence')>();
  return {
    ...actual,
    listBillingEvidenceBlockers: listBillingEvidenceBlockersMock,
  };
});

vi.mock('@/server/services/home-care-ops', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/services/home-care-ops')>();
  return {
    ...actual,
    getPatientHomeCareFeatureSummary: patientHomeCareFeatureSummaryMock,
    selectScheduleHomeCareFeatureHighlights: scheduleFeatureHighlightsMock,
  };
});

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
    getPatientHeaderSummary: getPatientHeaderSummaryMock,
    getPatientOverview: getPatientOverviewMock,
  };
});

import { GET as auditLogsGet } from '../audit-logs/route';
import { GET as auditLogsExportGet } from '../audit-logs/export/route';
import { GET as adminExternalProfessionalCommunicationsGet } from '../admin/external-professionals/[id]/communications/route';
import { GET as adminFacilityPatientsGet } from '../admin/facilities/[id]/patients/route';
import { GET as billingCandidatesGet } from '../billing-candidates/route';
import { GET as billingDocumentPdfGet } from '../billing-candidates/[id]/documents/pdf/route';
import { GET as billingCandidatesExportGet } from '../billing-candidates/export/route';
import { GET as businessHolidaysGet } from '../business-holidays/route';
import { GET as careReportsGet } from '../care-reports/route';
import { GET as careReportGet } from '../care-reports/[id]/route';
import { GET as careReportsAnalyticsGet } from '../care-reports/analytics/route';
import { GET as careReportsTodayWorkspaceGet } from '../care-reports/today-workspace/route';
import { GET as casesGet } from '../cases/route';
import { GET as caseGet } from '../cases/[id]/route';
import { GET as communicationEventsGet } from '../communication-events/route';
import { GET as communicationRequestsGet } from '../communication-requests/route';
import { GET as communicationRequestGet } from '../communication-requests/[id]/route';
import { GET as communicationRequestResponsesGet } from '../communication-requests/[id]/responses/route';
import { GET as communicationRequestsExportGet } from '../communication-requests/export/route';
import { GET as commentsGet } from '../comments/route';
import { GET as commentsRecentGet } from '../comments/recent/route';
import { GET as conferenceNotesGet } from '../conference-notes/route';
import { GET as conferenceNoteGet } from '../conference-notes/[id]/route';
import { GET as consentRecordsGet } from '../consent-records/route';
import { GET as consentRecordGet } from '../consent-records/[id]/route';
import { GET as contactProfilesGet } from '../contact-profiles/route';
import { GET as dashboardClerkSupportGet } from '../dashboard/clerk-support/route';
import { GET as dashboardCockpitGet } from '../dashboard/cockpit/route';
import { GET as dashboardDispensingStatsGet } from '../dashboard/dispensing-stats/route';
import { GET as dashboardWorkflowGet } from '../dashboard/workflow/route';
import { GET as dashboardMedicationDeadlinesGet } from '../dashboard/medication-deadlines/route';
import { GET as dashboardMonthlyStatsGet } from '../dashboard/monthly-stats/route';
import { GET as dashboardOverdueGet } from '../dashboard/overdue/route';
import { GET as dispenseAuditsGet } from '../dispense-audits/route';
import { GET as dispenseQueueGet } from '../dispense-queue/route';
import { GET as dispenseWorkbenchPatientsGet } from '../dispense-workbench/patients/route';
import { GET as dispenseResultGet } from '../dispense-results/[id]/route';
import { GET as dispenseTasksGet } from '../dispense-tasks/route';
import { GET as dispenseTaskGet } from '../dispense-tasks/[id]/route';
import { GET as dispenseTaskWorkbenchGet } from '../dispense-tasks/[id]/workbench/route';
import { GET as externalProfessionalCommunicationsGet } from '../external-professionals/[id]/communications/route';
import { GET as facilityContactsGet } from '../facilities/[id]/contacts/route';
import { GET as facilityPatientsGet } from '../facilities/[id]/patients/route';
import { GET as firstVisitDocumentsGet } from '../first-visit-documents/route';
import { GET as handoffBoardGet } from '../handoff-board/route';
import { GET as inquiryRecordsGet } from '../inquiry-records/route';
import { GET as incidentReportsGet } from '../incident-reports/route';
import { GET as interventionsGet } from '../interventions/route';
import { GET as managementPlansGet } from '../management-plans/route';
import { GET as managementPlanGet } from '../management-plans/[id]/route';
import { GET as medicationCyclesGet } from '../medication-cycles/route';
import { GET as medicationIssuesGet } from '../medication-issues/route';
import { GET as medicationSetsWorkspaceGet } from '../medication-sets/workspace/route';
import { GET as medicationProfilesGet } from '../medication-profiles/route';
import { GET as notificationsGet } from '../notifications/route';
import { GET as orgMembersGet } from '../org/members/route';
import { GET as patientsGet } from '../patients/route';
import { GET as patientsBoardGet } from '../patients/board/route';
import { GET as patientCheckDuplicateGet } from '../patients/check-duplicate/route';
import { GET as patientGet } from '../patients/[id]/route';
import { GET as patientHeaderSummaryGet } from '../patients/[id]/header-summary/route';
import { GET as patientOverviewGet } from '../patients/[id]/overview/route';
import { GET as patientPrescriptionsGet } from '../patients/[id]/prescriptions/route';
import { GET as patientShareCaseCorrectionRequestsGet } from '../patient-share-cases/[id]/correction-requests/route';
import { GET as patientSelfReportsGet } from '../patient-self-reports/route';
import { GET as patientSelfReportGet } from '../patient-self-reports/[id]/route';
import { GET as patientVisitBriefGet } from '../patients/[id]/visit-brief/route';
import { GET as patientVisitRecordsPdfGet } from '../patients/[id]/visit-records/pdf/route';
import { GET as pharmacistsGet } from '../pharmacists/route';
import { GET as pharmacistShiftsGet } from '../pharmacist-shifts/route';
import { GET as pharmacistShiftsAvailableGet } from '../pharmacist-shifts/available/route';
import { GET as partnerVisitRecordsGet } from '../partner-visit-records/route';
import { GET as pharmacyPartnershipsGet } from '../pharmacy-partnerships/route';
import { GET as pharmacyVisitRequestsGet } from '../pharmacy-visit-requests/route';
import { GET as pharmacyInvoicePdfGet } from '../pharmacy-invoices/[id]/pdf/route';
import { GET as pharmacySitesGet } from '../pharmacy-sites/route';
import { GET as pcaPumpRentalsGet } from '../pca-pump-rentals/route';
import { GET as prescriberInstitutionsGet } from '../prescriber-institutions/route';
import { GET as prescriptionIntakesGet } from '../prescription-intakes/route';
import { GET as prescriptionIntakeGet } from '../prescription-intakes/[id]/route';
import { GET as prescriptionIntakeTriageGet } from '../prescription-intakes/triage/route';
import { GET as qrScanDraftsGet } from '../qr-scan-drafts/route';
import { GET as qrScanDraftGet } from '../qr-scan-drafts/[id]/route';
import { GET as residualMedicationsGet } from '../residual-medications/route';
import { GET as setAuditsGet } from '../set-audits/route';
import { GET as setBatchesGet } from '../set-batches/route';
import { GET as setBatchGet } from '../set-batches/[id]/route';
import { GET as setPlansGet } from '../set-plans/route';
import { GET as setPlanGet } from '../set-plans/[id]/route';
import { GET as setPlanCalendarGet } from '../set-plans/[id]/calendar/route';
import { GET as staffWorkloadGet } from '../staff-workload/route';
import { GET as tasksGet } from '../tasks/route';
import { GET as tracingReportsGet } from '../tracing-reports/route';
import { GET as visitRecordsGet } from '../visit-records/route';
import { GET as visitRecordGet } from '../visit-records/[id]/route';
import { GET as visitRecordHandoffGet } from '../visit-records/[id]/handoff/route';
import { GET as visitRecordPdfGet } from '../visit-records/[id]/pdf/route';
import { GET as visitRecordReflectedFieldsGet } from '../visit-records/[id]/reflected-fields/route';
import { GET as visitScheduleProposalsGet } from '../visit-schedule-proposals/route';
import { GET as visitScheduleProposalGet } from '../visit-schedule-proposals/[id]/route';
import { GET as visitSchedulesGet } from '../visit-schedules/route';
import { GET as visitScheduleGet } from '../visit-schedules/[id]/route';
import { GET as visitSchedulesDayBoardGet } from '../visit-schedules/day-board/route';
import { GET as visitsTodayPreparationGet } from '../visits/today-preparation/route';
import { GET as visitPreparationGet } from '../visit-preparations/[scheduleId]/route';
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
    name: 'admin/external-professionals/[id]/communications GET',
    setupSuccess: () => {
      prismaMock.externalProfessional.findFirst.mockResolvedValueOnce({
        id: 'external_1',
        name: '佐藤医師',
        organization_name: 'あおばクリニック',
      });
      prismaMock.communicationRequest.findMany.mockResolvedValueOnce([
        {
          id: 'request_1',
          request_type: 'care_report_followup',
          recipient_name: '佐藤医師',
          recipient_role: 'physician',
          subject: '報告書確認',
          status: 'sent',
          requested_at: new Date('2026-03-30T00:00:00.000Z'),
        },
      ]);
      prismaMock.communicationEvent.findMany.mockResolvedValueOnce([
        {
          id: 'event_1',
          event_type: 'phone_call',
          channel: 'phone',
          direction: 'outbound',
          counterpart_name: '佐藤医師',
          subject: '電話確認',
          occurred_at: new Date('2026-03-29T00:00:00.000Z'),
        },
      ]);
    },
    handler: () =>
      adminExternalProfessionalCommunicationsGet(
        createRequest(
          'http://localhost/api/admin/external-professionals/external_1/communications',
          { 'x-org-id': 'org_1' },
        ),
        { params: Promise.resolve({ id: 'external_1' }) },
      ),
  },
  {
    name: 'admin/facilities/[id]/patients GET',
    handler: () =>
      adminFacilityPatientsGet(
        createRequest('http://localhost/api/admin/facilities/facility_1/patients', {
          'x-org-id': 'org_1',
        }),
        { params: Promise.resolve({ id: 'facility_1' }) },
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
    name: 'care-reports/today-workspace GET',
    handler: () =>
      careReportsTodayWorkspaceGet(
        createRequest('http://localhost/api/care-reports/today-workspace?date=2026-06-12', {
          'x-org-id': 'org_1',
        }),
        emptyRouteContext,
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
    name: 'cases/[id] GET',
    setupSuccess: () => {
      prismaMock.firstVisitDocument.findFirst.mockResolvedValueOnce(null);
    },
    handler: () =>
      caseGet(createRequest('http://localhost/api/cases/case_1', { 'x-org-id': 'org_1' }), {
        params: Promise.resolve({ id: 'case_1' }),
      }),
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
    name: 'communication-requests/[id] GET',
    handler: () =>
      communicationRequestGet(
        createRequest('http://localhost/api/communication-requests/request_1', {
          'x-org-id': 'org_1',
        }),
        { params: Promise.resolve({ id: 'request_1' }) },
      ),
  },
  {
    name: 'communication-requests/[id]/responses GET',
    setupSuccess: () => {
      prismaMock.communicationRequest.findFirst.mockResolvedValueOnce({
        id: 'request_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        related_entity_type: null,
        updated_at: new Date('2026-06-12T00:00:00.000Z'),
      });
    },
    handler: () =>
      communicationRequestResponsesGet(
        createRequest('http://localhost/api/communication-requests/request_1/responses', {
          'x-org-id': 'org_1',
        }),
        { params: Promise.resolve({ id: 'request_1' }) },
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
    name: 'comments GET',
    handler: () =>
      commentsGet(
        createRequest('http://localhost/api/comments?entity_type=dispense_task&entity_id=task_1', {
          'x-org-id': 'org_1',
        }),
        emptyRouteContext,
      ),
  },
  {
    name: 'comments/recent GET',
    handler: () =>
      commentsRecentGet(
        createRequest('http://localhost/api/comments/recent', { 'x-org-id': 'org_1' }),
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
    name: 'conference-notes/[id] GET',
    setupSuccess: () => {
      prismaMock.conferenceNote.findFirst.mockResolvedValueOnce({
        id: 'note_1',
        org_id: 'org_1',
        case_id: 'case_1',
        patient_id: 'patient_1',
        facility_id: 'facility_1',
        note_type: 'service_manager',
        title: '担当者会議',
        content: '会議目的',
        structured_content: null,
        metadata: {
          billing: { link_status: 'candidate', code: 'MED_INFO_PROVISION_2_HA' },
        },
        billing_eligible: false,
        billing_code: null,
        follow_up_date: null,
        follow_up_completed: false,
        generated_report_id: null,
        participants: [],
        conference_date: new Date('2026-03-30T10:00:00.000Z'),
        action_items: [],
        created_at: new Date('2026-03-30T11:00:00.000Z'),
        updated_at: new Date('2026-03-30T11:30:00.000Z'),
      });
    },
    handler: () =>
      conferenceNoteGet(
        createRequest('http://localhost/api/conference-notes/note_1', { 'x-org-id': 'org_1' }),
        { params: Promise.resolve({ id: 'note_1' }) },
      ),
  },
  {
    name: 'consent-records GET',
    handler: () =>
      consentRecordsGet(
        createRequest('http://localhost/api/consent-records?patient_id=patient_1', {
          'x-org-id': 'org_1',
        }),
        emptyRouteContext,
      ),
  },
  {
    name: 'consent-records/[id] GET',
    setupSuccess: () => {
      const record = {
        id: 'consent_1',
        patient_id: 'patient_1',
        case_id: null,
        consent_type: 'external_sharing',
        method: 'paper_scan',
        is_active: true,
        expiry_date: new Date('2026-12-31T00:00:00.000Z'),
        document_url: '/api/files/file_1/presigned-download?download=1',
        document_file_id: null,
        template_id: 'template_1',
        template_version: 2,
        updated_at: new Date('2026-01-01T00:00:00.000Z'),
      };
      prismaMock.consentRecord.findFirst.mockResolvedValueOnce({
        id: record.id,
        patient_id: record.patient_id,
        case_id: record.case_id,
      });
      prismaMock.consentRecord.findFirst.mockResolvedValueOnce(record);
    },
    handler: () =>
      consentRecordGet(
        createRequest('http://localhost/api/consent-records/consent_1', {
          'x-org-id': 'org_1',
        }),
        { params: Promise.resolve({ id: 'consent_1' }) },
      ),
  },
  {
    name: 'contact-profiles GET',
    setupSuccess: () => {
      prismaMock.externalProfessional.findMany.mockResolvedValueOnce([]);
    },
    handler: () =>
      contactProfilesGet(
        createRequest('http://localhost/api/contact-profiles?kind=external_professional&limit=8', {
          'x-org-id': 'org_1',
        }),
        emptyRouteContext,
      ),
  },
  {
    name: 'notifications GET',
    handler: () =>
      notificationsGet(
        createRequest('http://localhost/api/notifications?user_id=user_2', {
          'x-org-id': 'org_1',
        }),
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
    name: 'dispense-workbench/patients GET',
    handler: () =>
      dispenseWorkbenchPatientsGet(
        createRequest('http://localhost/api/dispense-workbench/patients', {
          'x-org-id': 'org_1',
        }),
        emptyRouteContext,
      ),
  },
  {
    name: 'dispense-results/[id] GET',
    handler: () =>
      dispenseResultGet(
        createRequest('http://localhost/api/dispense-results/result_1', { 'x-org-id': 'org_1' }),
        { params: Promise.resolve({ id: 'result_1' }) },
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
    name: 'dispense-tasks/[id] GET',
    setupSuccess: () => {
      prismaMock.membership.findFirst
        .mockResolvedValueOnce({ role: 'admin' })
        .mockResolvedValueOnce({
          site_id: null,
          user: {
            default_site_id: 'site_1',
          },
        });
      prismaMock.pharmacySite.findFirst.mockResolvedValueOnce({ id: 'site_1', name: '本店' });
      prismaMock.dispenseTask.findFirst.mockResolvedValueOnce({
        id: 'task_1',
        cycle_id: 'cycle_1',
        priority: 'normal',
        due_date: null,
        status: 'pending',
        results: [],
        audits: [],
        cycle: {
          id: 'cycle_1',
          patient_id: 'patient_1',
          overall_status: 'ready_to_dispense',
          inquiries: [],
          case_: {
            id: 'case_1',
            primary_pharmacist_id: 'user_1',
            patient: {
              id: 'patient_1',
              name: '患者A',
              name_kana: 'カンジャ エー',
              residences: [],
            },
          },
          prescription_intakes: [],
        },
      });
    },
    handler: () =>
      dispenseTaskGet(
        createRequest('http://localhost/api/dispense-tasks/task_1', { 'x-org-id': 'org_1' }),
        { params: Promise.resolve({ id: 'task_1' }) },
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
    name: 'external-professionals/[id]/communications GET',
    setupSuccess: () => {
      prismaMock.externalProfessional.findFirst.mockResolvedValueOnce({
        id: 'external_1',
        name: '佐藤医師',
        organization_name: 'あおばクリニック',
      });
      prismaMock.communicationRequest.findMany.mockResolvedValueOnce([
        {
          id: 'request_1',
          request_type: 'care_report_followup',
          recipient_name: '佐藤医師',
          recipient_role: 'physician',
          subject: '報告書確認',
          status: 'sent',
          requested_at: new Date('2026-03-30T00:00:00.000Z'),
        },
      ]);
      prismaMock.communicationEvent.findMany.mockResolvedValueOnce([]);
    },
    handler: () =>
      externalProfessionalCommunicationsGet(
        createRequest('http://localhost/api/external-professionals/external_1/communications', {
          'x-org-id': 'org_1',
        }),
        { params: Promise.resolve({ id: 'external_1' }) },
      ),
  },
  {
    name: 'facilities/[id]/patients GET',
    handler: () =>
      facilityPatientsGet(
        createRequest('http://localhost/api/facilities/facility_1/patients', {
          'x-org-id': 'org_1',
        }),
        { params: Promise.resolve({ id: 'facility_1' }) },
      ),
  },
  {
    name: 'facilities/[id]/contacts GET',
    setupSuccess: () => {
      prismaMock.facility.findFirst.mockResolvedValueOnce({
        id: 'facility_1',
        contacts: [
          {
            id: 'contact_1',
            name: '相談員A',
            role: '相談員',
            phone: '03-1111-2222',
            email: null,
            fax: null,
            is_primary: true,
            notes: null,
          },
        ],
      });
    },
    handler: () =>
      facilityContactsGet(
        createRequest('http://localhost/api/facilities/facility_1/contacts', {
          'x-org-id': 'org_1',
        }),
        { params: Promise.resolve({ id: 'facility_1' }) },
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
    name: 'handoff-board GET',
    setupSuccess: () => {
      txMock.handoffBoard.findUnique.mockResolvedValueOnce({
        id: 'board_1',
        org_id: 'org_1',
        shift_date: new Date('2026-06-12T00:00:00.000Z'),
        items: [],
      });
      txMock.handoffItem.count.mockResolvedValueOnce(0);
      prismaMock.user.findMany.mockResolvedValueOnce([]);
      prismaMock.membership.findMany.mockResolvedValueOnce([]);
    },
    handler: () =>
      handoffBoardGet(
        createRequest('http://localhost/api/handoff-board?date=2026-06-12', {
          'x-org-id': 'org_1',
        }),
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
    name: 'incident-reports GET',
    handler: () =>
      incidentReportsGet(
        createRequest('http://localhost/api/incident-reports', { 'x-org-id': 'org_1' }),
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
    name: 'medication-sets/workspace GET',
    handler: () =>
      medicationSetsWorkspaceGet(
        createRequest('http://localhost/api/medication-sets/workspace', { 'x-org-id': 'org_1' }),
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
    name: 'patients/[id]/header-summary GET',
    setupSuccess: () => {
      getPatientHeaderSummaryMock.mockResolvedValueOnce({
        primary_pharmacist_name: '薬剤師 花子',
        backup_pharmacist_name: '薬剤師 太郎',
        primary_staff_name: '事務 ひかり',
        backup_staff_name: '事務 まこと',
        first_visit_date: '2026-01-05T09:00:00.000Z',
        last_prescribed_date: '2026-06-01T00:00:00.000Z',
        next_prescription_expected_date: null,
      });
    },
    handler: () =>
      patientHeaderSummaryGet(
        createRequest('http://localhost/api/patients/patient_1/header-summary', {
          'x-org-id': 'org_1',
        }),
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
    name: 'org/members GET',
    handler: () =>
      orgMembersGet(
        createRequest('http://localhost/api/org/members?eligible=staff', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'patient-share-cases/[id]/correction-requests GET',
    setupSuccess: () => {
      txMock.patientShareCase.findFirst.mockResolvedValueOnce({
        id: 'share_case_1',
        base_patient_id: 'patient_1',
      });
      txMock.patientShareCorrectionRequest.findMany.mockResolvedValueOnce([]);
    },
    handler: () =>
      patientShareCaseCorrectionRequestsGet(
        createRequest('http://localhost/api/patient-share-cases/share_case_1/correction-requests', {
          'x-org-id': 'org_1',
        }),
        { params: Promise.resolve({ id: 'share_case_1' }) },
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
    name: 'partner-visit-records GET',
    handler: () =>
      partnerVisitRecordsGet(
        createRequest('http://localhost/api/partner-visit-records', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'pharmacy-partnerships GET',
    handler: () =>
      pharmacyPartnershipsGet(
        createRequest('http://localhost/api/pharmacy-partnerships', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'pharmacy-visit-requests GET',
    handler: () =>
      pharmacyVisitRequestsGet(
        createRequest('http://localhost/api/pharmacy-visit-requests', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'pca-pump-rentals GET',
    handler: () =>
      pcaPumpRentalsGet(
        createRequest('http://localhost/api/pca-pump-rentals', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'prescriber-institutions GET',
    handler: () =>
      prescriberInstitutionsGet(
        createRequest('http://localhost/api/prescriber-institutions?q=clinic&limit=8', {
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
    name: 'prescription-intakes/triage GET',
    handler: () =>
      prescriptionIntakeTriageGet(
        createRequest('http://localhost/api/prescription-intakes/triage', {
          'x-org-id': 'org_1',
        }),
        emptyRouteContext,
      ),
  },
  {
    name: 'qr-scan-drafts GET',
    handler: () =>
      qrScanDraftsGet(
        createRequest('http://localhost/api/qr-scan-drafts', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'qr-scan-drafts/[id] GET',
    handler: () =>
      qrScanDraftGet(
        createRequest('http://localhost/api/qr-scan-drafts/draft_1', { 'x-org-id': 'org_1' }),
        { params: Promise.resolve({ id: 'draft_1' }) },
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
    name: 'set-audits GET',
    handler: () =>
      setAuditsGet(
        createRequest('http://localhost/api/set-audits', { 'x-org-id': 'org_1' }),
        emptyRouteContext,
      ),
  },
  {
    name: 'set-batches GET',
    handler: () =>
      setBatchesGet(
        createRequest('http://localhost/api/set-batches?plan_id=plan_1', { 'x-org-id': 'org_1' }),
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
    name: 'set-batches/[id] GET',
    handler: () =>
      setBatchGet(
        createRequest('http://localhost/api/set-batches/batch_1', { 'x-org-id': 'org_1' }),
        {
          params: Promise.resolve({ id: 'batch_1' }),
        },
      ),
  },
  {
    name: 'set-plans/[id] GET',
    handler: () =>
      setPlanGet(createRequest('http://localhost/api/set-plans/plan_1', { 'x-org-id': 'org_1' }), {
        params: Promise.resolve({ id: 'plan_1' }),
      }),
  },
  {
    name: 'set-plans/[id]/calendar GET',
    handler: () =>
      setPlanCalendarGet(
        createRequest('http://localhost/api/set-plans/plan_1/calendar', { 'x-org-id': 'org_1' }),
        { params: Promise.resolve({ id: 'plan_1' }) },
      ),
    setupSuccess: () => {
      prismaMock.setPlan.findFirst.mockResolvedValueOnce({
        id: 'plan_1',
        cycle_id: 'cycle_1',
        target_period_start: new Date('2026-04-01T00:00:00.000Z'),
        target_period_end: new Date('2026-04-07T00:00:00.000Z'),
        set_method: 'custom',
        cycle: {
          id: 'cycle_1',
          overall_status: 'setting',
          version: 1,
        },
      });
      prismaMock.setBatch.findMany.mockResolvedValueOnce([]);
      prismaMock.prescriptionIntake.findMany.mockResolvedValueOnce([]);
    },
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
    name: 'visit-schedule-proposals/[id] GET',
    setupSuccess: () => {
      prismaMock.visitScheduleProposal.findFirst.mockResolvedValueOnce({
        id: 'proposal_1',
        org_id: 'org_1',
        case_id: 'case_1',
        cycle_id: 'cycle_1',
        site_id: 'site_1',
        visit_type: 'regular',
        priority: 'normal',
        proposal_status: 'proposed',
        patient_contact_status: 'pending',
        proposed_date: new Date('2026-06-12T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
        proposed_pharmacist_id: 'user_1',
        assignment_mode: 'primary',
        route_order: 1,
        vehicle_resource_id: null,
        vehicle_resource: null,
        created_at: new Date('2026-06-11T00:00:00.000Z'),
        medication_end_date: null,
        visit_deadline_date: null,
        escalation_reason: null,
        suggested_recurrence_rule: null,
        finalized_schedule_id: null,
        reschedule_source_schedule_id: null,
        finalized_schedule: null,
        reschedule_source_schedule: null,
        contact_logs: [],
        case_: {
          patient: {
            id: 'patient_1',
            name: '患者A',
            residences: [
              {
                address: '東京都千代田区1-1-1',
                building_id: null,
                unit_name: null,
                lat: 35.2,
                lng: 139.2,
              },
            ],
          },
        },
        site: {
          id: 'site_1',
          name: '拠点A',
          address: '東京都千代田区2-2-2',
          lat: 35.1,
          lng: 139.1,
        },
      });
      prismaMock.visitScheduleProposal.findMany.mockResolvedValueOnce([]);
      prismaMock.visitSchedule.findMany.mockResolvedValueOnce([]);
      prismaMock.auditLog.findFirst.mockResolvedValueOnce(null);
      prismaMock.user.findMany.mockResolvedValueOnce([{ id: 'user_1', name: '薬剤師A' }]);
    },
    handler: () =>
      visitScheduleProposalGet(
        createRequest('http://localhost/api/visit-schedule-proposals/proposal_1', {
          'x-org-id': 'org_1',
        }),
        { params: Promise.resolve({ id: 'proposal_1' }) },
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
    name: 'visit-preparations/[scheduleId] GET',
    setupSuccess: () => {
      prismaMock.visitSchedule.findFirst.mockResolvedValueOnce({
        id: 'schedule_1',
        case_id: 'case_1',
        scheduled_date: new Date('2026-06-12T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
        visit_type: 'regular',
        schedule_status: 'planned',
        carry_items_status: 'ready',
        priority: 'normal',
        pharmacist_id: 'user_1',
        facility_batch_id: null,
        facility_batch: null,
        route_order: null,
        medication_start_date: null,
        medication_end_date: null,
        assignment_mode: 'primary',
        escalation_reason: null,
        confirmed_at: null,
        site: null,
        visit_record: null,
        preparation: null,
        override_request: null,
        applied_override: null,
        case_: {
          id: 'case_1',
          primary_pharmacist_id: 'user_1',
          backup_pharmacist_id: null,
          required_visit_support: null,
          patient: {
            id: 'patient_1',
            name: '患者A',
            name_kana: 'カンジャエー',
            birth_date: new Date('1950-01-01T00:00:00.000Z'),
            gender: 'female',
            residences: [],
            contacts: [],
            consents: [],
            scheduling_preference: null,
          },
          care_team_links: [],
          management_plans: [],
        },
      });
      prismaMock.visitRecord.findFirst.mockResolvedValueOnce(null);
      prismaMock.firstVisitDocument.findFirst.mockResolvedValueOnce(null);
    },
    handler: () =>
      visitPreparationGet(
        createRequest('http://localhost/api/visit-preparations/schedule_1', {
          'x-org-id': 'org_1',
        }),
        { params: Promise.resolve({ scheduleId: 'schedule_1' }) },
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
    listBillingEvidenceBlockersMock.mockResolvedValue([]);
    patientHomeCareFeatureSummaryMock.mockResolvedValue({
      totals: { blocked: 0, attention: 0, monitoring: 0, ready: 20 },
      features: [],
    });
    scheduleFeatureHighlightsMock.mockReturnValue([]);
  });

  for (const route of routes) {
    it(`${route.name} returns 401 when unauthenticated`, async () => {
      authMock.mockResolvedValue(null);

      const response = await route.handler();

      expect(response).toBeDefined();
      if (!response) throw new Error('response is required');
      expect(response.status).toBe(401);
      if (
        route.name === 'audit-logs GET' ||
        route.name === 'audit-logs/export GET' ||
        route.name === 'admin/external-professionals/[id]/communications GET' ||
        route.name === 'admin/facilities/[id]/patients GET' ||
        route.name === 'prescription-intakes GET' ||
        route.name === 'prescription-intakes/[id] GET' ||
        route.name === 'prescription-intakes/triage GET' ||
        route.name === 'qr-scan-drafts GET' ||
        route.name === 'qr-scan-drafts/[id] GET' ||
        route.name === 'medication-cycles GET' ||
        route.name === 'medication-issues GET' ||
        route.name === 'medication-sets/workspace GET' ||
        route.name === 'medication-profiles GET' ||
        route.name === 'billing-candidates GET' ||
        route.name === 'billing-candidates/export GET' ||
        route.name === 'dispense-results/[id] GET' ||
        route.name === 'dispense-tasks GET' ||
        route.name === 'dispense-tasks/[id] GET' ||
        route.name === 'dispense-tasks/[id]/workbench GET' ||
        route.name === 'tasks GET' ||
        route.name === 'patients GET' ||
        route.name === 'patients/board GET' ||
        route.name === 'patients/check-duplicate GET' ||
        route.name === 'patients/[id] GET' ||
        route.name === 'patients/[id]/header-summary GET' ||
        route.name === 'communication-events GET' ||
        route.name === 'communication-requests GET' ||
        route.name === 'communication-requests/[id] GET' ||
        route.name === 'communication-requests/[id]/responses GET' ||
        route.name === 'comments GET' ||
        route.name === 'comments/recent GET' ||
        route.name === 'conference-notes GET' ||
        route.name === 'conference-notes/[id] GET' ||
        route.name === 'consent-records GET' ||
        route.name === 'consent-records/[id] GET' ||
        route.name === 'contact-profiles GET' ||
        route.name === 'notifications GET' ||
        route.name === 'handoff-board GET' ||
        route.name === 'patients/[id]/overview GET' ||
        route.name === 'patients/[id]/prescriptions GET' ||
        route.name === 'patient-share-cases/[id]/correction-requests GET' ||
        route.name === 'partner-visit-records GET' ||
        route.name === 'pharmacists GET' ||
        route.name === 'pharmacy-partnerships GET' ||
        route.name === 'pharmacy-visit-requests GET' ||
        route.name === 'pca-pump-rentals GET' ||
        route.name === 'prescriber-institutions GET' ||
        route.name === 'first-visit-documents GET' ||
        route.name === 'incident-reports GET' ||
        route.name === 'care-reports/[id] GET' ||
        route.name === 'care-reports/analytics GET' ||
        route.name === 'care-reports/today-workspace GET' ||
        route.name === 'cases GET' ||
        route.name === 'cases/[id] GET' ||
        route.name === 'management-plans GET' ||
        route.name === 'management-plans/[id] GET' ||
        route.name === 'visit-records/[id] GET' ||
        route.name === 'visit-schedules GET' ||
        route.name === 'visit-schedules/[id] GET' ||
        route.name === 'visit-schedules/day-board GET' ||
        route.name === 'visits/today-preparation GET' ||
        route.name === 'visit-preparations/[scheduleId] GET' ||
        route.name === 'visit-preparations/[scheduleId]/brief GET' ||
        route.name === 'visit-schedule-proposals GET' ||
        route.name === 'visit-schedule-proposals/[id] GET' ||
        route.name === 'set-audits GET' ||
        route.name === 'set-batches GET' ||
        route.name === 'set-plans GET' ||
        route.name === 'set-batches/[id] GET' ||
        route.name === 'set-plans/[id] GET' ||
        route.name === 'set-plans/[id]/calendar GET' ||
        route.name === 'staff-workload GET' ||
        route.name === 'tracing-reports GET' ||
        route.name === 'dashboard/clerk-support GET' ||
        route.name === 'dashboard/cockpit GET' ||
        route.name === 'dashboard/dispensing-stats GET' ||
        route.name === 'dashboard/workflow GET' ||
        route.name === 'dashboard/overdue GET' ||
        route.name === 'dashboard/medication-deadlines GET' ||
        route.name === 'dashboard/monthly-stats GET' ||
        route.name === 'dispense-audits GET' ||
        route.name === 'dispense-queue GET' ||
        route.name === 'dispense-workbench/patients GET' ||
        route.name === 'external-professionals/[id]/communications GET' ||
        route.name === 'facilities/[id]/contacts GET' ||
        route.name === 'facilities/[id]/patients GET'
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
        route.name === 'audit-logs GET' ||
        route.name === 'audit-logs/export GET' ||
        route.name === 'admin/external-professionals/[id]/communications GET' ||
        route.name === 'admin/facilities/[id]/patients GET' ||
        route.name === 'prescription-intakes GET' ||
        route.name === 'prescription-intakes/[id] GET' ||
        route.name === 'prescription-intakes/triage GET' ||
        route.name === 'qr-scan-drafts GET' ||
        route.name === 'qr-scan-drafts/[id] GET' ||
        route.name === 'medication-cycles GET' ||
        route.name === 'medication-issues GET' ||
        route.name === 'medication-sets/workspace GET' ||
        route.name === 'medication-profiles GET' ||
        route.name === 'billing-candidates GET' ||
        route.name === 'billing-candidates/export GET' ||
        route.name === 'dispense-results/[id] GET' ||
        route.name === 'dispense-tasks GET' ||
        route.name === 'dispense-tasks/[id] GET' ||
        route.name === 'dispense-tasks/[id]/workbench GET' ||
        route.name === 'tasks GET' ||
        route.name === 'patients GET' ||
        route.name === 'patients/board GET' ||
        route.name === 'patients/check-duplicate GET' ||
        route.name === 'patients/[id] GET' ||
        route.name === 'patients/[id]/header-summary GET' ||
        route.name === 'communication-events GET' ||
        route.name === 'communication-requests GET' ||
        route.name === 'communication-requests/[id] GET' ||
        route.name === 'communication-requests/[id]/responses GET' ||
        route.name === 'comments GET' ||
        route.name === 'comments/recent GET' ||
        route.name === 'conference-notes GET' ||
        route.name === 'conference-notes/[id] GET' ||
        route.name === 'consent-records GET' ||
        route.name === 'consent-records/[id] GET' ||
        route.name === 'contact-profiles GET' ||
        route.name === 'notifications GET' ||
        route.name === 'handoff-board GET' ||
        route.name === 'patients/[id]/overview GET' ||
        route.name === 'patients/[id]/prescriptions GET' ||
        route.name === 'patient-share-cases/[id]/correction-requests GET' ||
        route.name === 'partner-visit-records GET' ||
        route.name === 'pharmacists GET' ||
        route.name === 'pharmacy-partnerships GET' ||
        route.name === 'pharmacy-visit-requests GET' ||
        route.name === 'pca-pump-rentals GET' ||
        route.name === 'prescriber-institutions GET' ||
        route.name === 'first-visit-documents GET' ||
        route.name === 'incident-reports GET' ||
        route.name === 'care-reports/[id] GET' ||
        route.name === 'care-reports/analytics GET' ||
        route.name === 'care-reports/today-workspace GET' ||
        route.name === 'cases GET' ||
        route.name === 'cases/[id] GET' ||
        route.name === 'management-plans GET' ||
        route.name === 'management-plans/[id] GET' ||
        route.name === 'visit-records/[id] GET' ||
        route.name === 'visit-schedules GET' ||
        route.name === 'visit-schedules/[id] GET' ||
        route.name === 'visit-schedules/day-board GET' ||
        route.name === 'visits/today-preparation GET' ||
        route.name === 'visit-preparations/[scheduleId] GET' ||
        route.name === 'visit-preparations/[scheduleId]/brief GET' ||
        route.name === 'visit-schedule-proposals GET' ||
        route.name === 'visit-schedule-proposals/[id] GET' ||
        route.name === 'set-audits GET' ||
        route.name === 'set-batches GET' ||
        route.name === 'set-plans GET' ||
        route.name === 'set-batches/[id] GET' ||
        route.name === 'set-plans/[id] GET' ||
        route.name === 'set-plans/[id]/calendar GET' ||
        route.name === 'staff-workload GET' ||
        route.name === 'tracing-reports GET' ||
        route.name === 'dashboard/clerk-support GET' ||
        route.name === 'dashboard/cockpit GET' ||
        route.name === 'dashboard/dispensing-stats GET' ||
        route.name === 'dashboard/workflow GET' ||
        route.name === 'dashboard/overdue GET' ||
        route.name === 'dashboard/medication-deadlines GET' ||
        route.name === 'dashboard/monthly-stats GET' ||
        route.name === 'dispense-audits GET' ||
        route.name === 'dispense-queue GET' ||
        route.name === 'dispense-workbench/patients GET' ||
        route.name === 'external-professionals/[id]/communications GET' ||
        route.name === 'facilities/[id]/contacts GET' ||
        route.name === 'facilities/[id]/patients GET'
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
      if (
        route.name === 'audit-logs GET' ||
        route.name === 'audit-logs/export GET' ||
        route.name === 'admin/external-professionals/[id]/communications GET' ||
        route.name === 'admin/facilities/[id]/patients GET' ||
        route.name === 'prescription-intakes/triage GET' ||
        route.name === 'visits/today-preparation GET' ||
        route.name === 'patients/[id] GET' ||
        route.name === 'patients/[id]/header-summary GET' ||
        route.name === 'communication-events GET' ||
        route.name === 'communication-requests GET' ||
        route.name === 'communication-requests/[id] GET' ||
        route.name === 'communication-requests/[id]/responses GET' ||
        route.name === 'comments GET' ||
        route.name === 'comments/recent GET' ||
        route.name === 'conference-notes GET' ||
        route.name === 'conference-notes/[id] GET' ||
        route.name === 'consent-records GET' ||
        route.name === 'consent-records/[id] GET' ||
        route.name === 'contact-profiles GET' ||
        route.name === 'notifications GET' ||
        route.name === 'handoff-board GET' ||
        route.name === 'medication-issues GET' ||
        route.name === 'medication-profiles GET' ||
        route.name === 'incident-reports GET' ||
        route.name === 'cases/[id] GET' ||
        route.name === 'dispense-queue GET' ||
        route.name === 'dispense-workbench/patients GET' ||
        route.name === 'external-professionals/[id]/communications GET' ||
        route.name === 'dispense-results/[id] GET' ||
        route.name === 'patient-share-cases/[id]/correction-requests GET' ||
        route.name === 'facilities/[id]/contacts GET' ||
        route.name === 'facilities/[id]/patients GET' ||
        route.name === 'partner-visit-records GET' ||
        route.name === 'pharmacists GET' ||
        route.name === 'pharmacy-partnerships GET' ||
        route.name === 'pharmacy-visit-requests GET' ||
        route.name === 'pca-pump-rentals GET' ||
        route.name === 'prescriber-institutions GET' ||
        route.name === 'visit-schedules GET' ||
        route.name === 'visit-schedules/[id] GET' ||
        route.name === 'visit-preparations/[scheduleId] GET' ||
        route.name === 'visit-preparations/[scheduleId]/brief GET' ||
        route.name === 'visit-schedule-proposals/[id] GET' ||
        route.name === 'set-audits GET' ||
        route.name === 'set-batches GET' ||
        route.name === 'set-batches/[id] GET' ||
        route.name === 'set-plans/[id] GET' ||
        route.name === 'set-plans/[id]/calendar GET'
      ) {
        expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
        expect(response.headers.get('Pragma')).toBe('no-cache');
      }
    });
  }
});
