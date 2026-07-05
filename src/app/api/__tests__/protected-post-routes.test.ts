import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const { authMock, membershipFindFirstMock, withOrgContextMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    patient: { findFirst: vi.fn().mockResolvedValue(null) },
    careCase: { findFirst: vi.fn().mockResolvedValue(null) },
    visitRecord: { findFirst: vi.fn().mockResolvedValue(null) },
    medicationIssue: { findFirst: vi.fn().mockResolvedValue(null) },
    medicationCycle: { findFirst: vi.fn().mockResolvedValue(null) },
    setPlan: { findFirst: vi.fn().mockResolvedValue(null) },
    dispenseTask: { findFirst: vi.fn().mockResolvedValue(null) },
    pharmacySite: { findFirst: vi.fn().mockResolvedValue(null) },
    visitSchedule: { findFirst: vi.fn().mockResolvedValue(null) },
    prescriptionLine: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { POST as casesPost } from '../cases/route';
import { POST as patientsPost } from '../patients/route';
import { POST as referralsPost } from '../referrals/route';
import { POST as medicationProfilesPost } from '../medication-profiles/route';
import { POST as medicationIssuesPost } from '../medication-issues/route';
import { POST as communicationEventsPost } from '../communication-events/route';
import { POST as communicationRequestsPost } from '../communication-requests/route';
import { POST as communicationRequestResponsesPost } from '../communication-requests/[id]/responses/route';
import { POST as communicationRequestResolveFollowupPost } from '../communication-requests/[id]/resolve-followup/route';
import { POST as conferenceNotesPost } from '../conference-notes/route';
import { POST as conferenceNoteGenerateReportPost } from '../conference-notes/[id]/generate-report/route';
import { POST as conferenceNoteTasksPost } from '../conference-notes/[id]/tasks/route';
import { POST as careReportsPost } from '../care-reports/route';
import { POST as documentDeliveryRulesPost } from '../document-delivery-rules/route';
import { POST as tasksPost } from '../tasks/route';
import { POST as consentRecordsPost } from '../consent-records/route';
import { POST as commentsPost } from '../comments/route';
import { POST as patientSelfReportsPost } from '../patient-self-reports/route';
import { POST as tracingReportsPost } from '../tracing-reports/route';
import { POST as visitSchedulesPost } from '../visit-schedules/route';
import { POST as visitSchedulesGeneratePost } from '../visit-schedules/generate/route';
import { POST as visitRecordsPost } from '../visit-records/route';
import { POST as prescriptionIntakesPost } from '../prescription-intakes/route';
import { POST as prescriptionIntakesFacilityBatchPost } from '../prescription-intakes/facility-batch/route';
import { POST as pharmacistShiftsPost } from '../pharmacist-shifts/route';
import { POST as pharmacistShiftsBulkPost } from '../pharmacist-shifts/bulk/route';
import { POST as setPlansPost } from '../set-plans/route';
import { POST as setPlanGenerateBatchesPost } from '../set-plans/[id]/generate-batches/route';
import { POST as setBatchesPost } from '../set-batches/route';
import { POST as setAuditsPost } from '../set-audits/route';
import { POST as dispenseAuditsPost } from '../dispense-audits/route';
import { POST as dispenseResultsPost } from '../dispense-results/route';
import { POST as inquiryRecordsPost } from '../inquiry-records/route';
import { POST as residualMedicationsPost } from '../residual-medications/route';
import { POST as incidentReportsPost } from '../incident-reports/route';
import { POST as pcaPumpsPost } from '../pca-pumps/route';
import { POST as pcaPumpRentalsPost } from '../pca-pump-rentals/route';
import { POST as billingCandidatesPost } from '../billing-candidates/route';
import { POST as billingCandidatesClosePost } from '../billing-candidates/close/route';
import { POST as firstVisitDocumentsPost } from '../first-visit-documents/route';
import { POST as firstVisitDocumentsPrintBatchPost } from '../first-visit-documents/print-batch/route';
import { POST as businessHolidaysPost } from '../business-holidays/route';
import { POST as cdsCheckPost } from '../cds/check/route';
import { POST as pharmacistsPost } from '../pharmacists/route';
import { POST as visitScheduleProposalsPost } from '../visit-schedule-proposals/route';
import { POST as visitPreparationBriefBatchPost } from '../visit-preparations/brief-batch/route';
import { POST as visitSchedulesReschedulePost } from '../visit-schedules/[id]/reschedule/route';

type Handler = (req: NextRequest) => Promise<Response | undefined>;
type RouteEntry = {
  name: string;
  handler: Handler;
  successBody?: unknown;
  invalidBody?: unknown;
  invalidBodyStatus?: number;
};
const emptyRouteContext = { params: Promise.resolve({}) };

function createRequest(headers?: Record<string, string>, body: unknown = {}) {
  return new NextRequest('http://localhost/api/test', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

const routes: RouteEntry[] = [
  { name: 'cases POST', handler: (req) => casesPost(req, emptyRouteContext) },
  { name: 'patients POST', handler: (req) => patientsPost(req, emptyRouteContext) },
  { name: 'referrals POST', handler: (req) => referralsPost(req, emptyRouteContext) },
  {
    name: 'medication-profiles POST',
    handler: (req) => medicationProfilesPost(req, emptyRouteContext),
  },
  {
    name: 'medication-issues POST',
    handler: (req) => medicationIssuesPost(req),
  },
  {
    name: 'communication-events POST',
    handler: (req) => communicationEventsPost(req, emptyRouteContext),
  },
  {
    name: 'communication-requests POST',
    handler: (req) => communicationRequestsPost(req, emptyRouteContext),
  },
  {
    name: 'communication-requests/[id]/responses POST',
    handler: (req) =>
      communicationRequestResponsesPost(req, { params: Promise.resolve({ id: 'request_1' }) }),
  },
  {
    name: 'communication-requests/[id]/resolve-followup POST',
    handler: (req) =>
      communicationRequestResolveFollowupPost(req, {
        params: Promise.resolve({ id: 'request_1' }),
      }),
  },
  { name: 'conference-notes POST', handler: (req) => conferenceNotesPost(req, emptyRouteContext) },
  {
    name: 'conference-notes/[id]/generate-report POST',
    handler: (req) =>
      conferenceNoteGenerateReportPost(req, { params: Promise.resolve({ id: 'note_1' }) }),
    invalidBody: [],
  },
  {
    name: 'conference-notes/[id]/tasks POST',
    handler: (req) => conferenceNoteTasksPost(req, { params: Promise.resolve({ id: 'note_1' }) }),
    invalidBody: [],
  },
  { name: 'care-reports POST', handler: (req) => careReportsPost(req) },
  {
    name: 'document-delivery-rules POST',
    handler: (req) => documentDeliveryRulesPost(req),
    invalidBody: [],
  },
  { name: 'tasks POST', handler: (req) => tasksPost(req), invalidBody: [] },
  { name: 'consent-records POST', handler: (req) => consentRecordsPost(req) },
  { name: 'comments POST', handler: (req) => commentsPost(req) },
  {
    name: 'patient-self-reports POST',
    handler: (req) => patientSelfReportsPost(req, emptyRouteContext),
  },
  { name: 'tracing-reports POST', handler: (req) => tracingReportsPost(req, emptyRouteContext) },
  { name: 'visit-schedules POST', handler: (req) => visitSchedulesPost(req, emptyRouteContext) },
  {
    name: 'visit-schedules/generate POST',
    handler: (req) => visitSchedulesGeneratePost(req, emptyRouteContext),
    invalidBodyStatus: 410,
  },
  { name: 'visit-records POST', handler: (req) => visitRecordsPost(req) },
  {
    name: 'prescription-intakes POST',
    handler: (req) => prescriptionIntakesPost(req, emptyRouteContext),
  },
  {
    name: 'prescription-intakes/facility-batch POST',
    handler: (req) => prescriptionIntakesFacilityBatchPost(req),
  },
  {
    name: 'pharmacist-shifts POST',
    handler: (req) => pharmacistShiftsPost(req, emptyRouteContext),
  },
  {
    name: 'pharmacist-shifts/bulk POST',
    handler: (req) => pharmacistShiftsBulkPost(req, emptyRouteContext),
  },
  { name: 'set-plans POST', handler: (req) => setPlansPost(req) },
  {
    name: 'set-plans/[id]/generate-batches POST',
    handler: (req) =>
      setPlanGenerateBatchesPost(req, { params: Promise.resolve({ id: 'plan_1' }) }),
    invalidBody: [],
  },
  { name: 'set-batches POST', handler: (req) => setBatchesPost(req) },
  { name: 'set-audits POST', handler: (req) => setAuditsPost(req) },
  { name: 'dispense-audits POST', handler: (req) => dispenseAuditsPost(req) },
  { name: 'dispense-results POST', handler: (req) => dispenseResultsPost(req) },
  { name: 'inquiry-records POST', handler: (req) => inquiryRecordsPost(req, emptyRouteContext) },
  { name: 'incident-reports POST', handler: (req) => incidentReportsPost(req, emptyRouteContext) },
  { name: 'pca-pumps POST', handler: (req) => pcaPumpsPost(req) },
  { name: 'pca-pump-rentals POST', handler: (req) => pcaPumpRentalsPost(req) },
  {
    name: 'residual-medications POST',
    handler: (req) => residualMedicationsPost(req, emptyRouteContext),
  },
  {
    name: 'billing-candidates POST',
    handler: (req) => billingCandidatesPost(req, emptyRouteContext),
  },
  {
    name: 'billing-candidates/close POST',
    handler: (req) => billingCandidatesClosePost(req),
    successBody: { billing_month: '2026-03-01' },
  },
  {
    name: 'first-visit-documents/print-batch POST',
    handler: (req) => firstVisitDocumentsPrintBatchPost(req),
  },
  {
    name: 'first-visit-documents POST',
    handler: (req) => firstVisitDocumentsPost(req),
  },
  {
    name: 'business-holidays POST',
    handler: (req) => businessHolidaysPost(req, emptyRouteContext),
  },
  { name: 'cds/check POST', handler: (req) => cdsCheckPost(req) },
  { name: 'pharmacists POST', handler: (req) => pharmacistsPost(req, emptyRouteContext) },
  {
    name: 'visit-schedule-proposals POST',
    handler: (req) => visitScheduleProposalsPost(req, emptyRouteContext),
  },
  { name: 'visit-preparations/brief-batch POST', handler: visitPreparationBriefBatchPost },
  {
    name: 'visit-schedules/[id]/reschedule POST',
    handler: (req) =>
      visitSchedulesReschedulePost(req, {
        params: Promise.resolve({ id: 'schedule_1' }),
      }),
  },
];

describe('protected POST routes auth/body matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Provide a minimal transaction stub for the billing close flow.
    // Other routes in this matrix either do not reach the transaction layer
    // with the invalid-body case or rely on their own mocks.
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        billingCandidate: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        billingEvidence: {
          findMany: vi.fn().mockResolvedValue([]),
          count: vi.fn().mockResolvedValue(0),
        },
        tracingReport: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        careReport: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        inquiryRecord: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      }),
    );
  });

  for (const route of routes) {
    it(`${route.name} returns 401 when unauthenticated`, async () => {
      authMock.mockResolvedValue(null);

      const response = await route.handler(createRequest({ 'x-org-id': 'org_1' }, {}));

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(401);
      if (
        route.name === 'cases POST' ||
        route.name === 'visit-preparations/brief-batch POST' ||
        route.name === 'prescription-intakes/facility-batch POST' ||
        route.name === 'communication-requests/[id]/responses POST' ||
        route.name === 'care-reports POST' ||
        route.name === 'inquiry-records POST' ||
        route.name === 'incident-reports POST' ||
        route.name === 'pca-pumps POST' ||
        route.name === 'pca-pump-rentals POST' ||
        route.name === 'consent-records POST' ||
        route.name === 'comments POST' ||
        route.name === 'cds/check POST' ||
        route.name === 'first-visit-documents/print-batch POST' ||
        route.name === 'first-visit-documents POST' ||
        route.name === 'patient-self-reports POST' ||
        route.name === 'medication-profiles POST' ||
        route.name === 'medication-issues POST' ||
        route.name === 'conference-notes/[id]/generate-report POST' ||
        route.name === 'conference-notes/[id]/tasks POST' ||
        route.name === 'document-delivery-rules POST' ||
        route.name === 'tasks POST' ||
        route.name === 'pharmacists POST' ||
        route.name === 'pharmacist-shifts POST' ||
        route.name === 'pharmacist-shifts/bulk POST' ||
        route.name === 'residual-medications POST' ||
        route.name === 'visit-records POST' ||
        route.name === 'set-plans POST' ||
        route.name === 'set-plans/[id]/generate-batches POST' ||
        route.name === 'set-batches POST' ||
        route.name === 'set-audits POST' ||
        route.name === 'dispense-results POST' ||
        route.name === 'dispense-audits POST'
      ) {
        expectSensitiveNoStore(response);
      }
    });

    it(`${route.name} returns 403 when role lacks permission`, async () => {
      authMock.mockResolvedValue({ user: { id: 'user_1' } });
      membershipFindFirstMock.mockResolvedValue({ role: 'driver' });

      const response = await route.handler(createRequest({ 'x-org-id': 'org_1' }, {}));

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(403);
      if (
        route.name === 'cases POST' ||
        route.name === 'visit-preparations/brief-batch POST' ||
        route.name === 'prescription-intakes/facility-batch POST' ||
        route.name === 'communication-requests/[id]/responses POST' ||
        route.name === 'care-reports POST' ||
        route.name === 'inquiry-records POST' ||
        route.name === 'incident-reports POST' ||
        route.name === 'pca-pumps POST' ||
        route.name === 'pca-pump-rentals POST' ||
        route.name === 'consent-records POST' ||
        route.name === 'comments POST' ||
        route.name === 'cds/check POST' ||
        route.name === 'first-visit-documents/print-batch POST' ||
        route.name === 'first-visit-documents POST' ||
        route.name === 'patient-self-reports POST' ||
        route.name === 'medication-profiles POST' ||
        route.name === 'medication-issues POST' ||
        route.name === 'conference-notes/[id]/generate-report POST' ||
        route.name === 'conference-notes/[id]/tasks POST' ||
        route.name === 'document-delivery-rules POST' ||
        route.name === 'tasks POST' ||
        route.name === 'pharmacists POST' ||
        route.name === 'pharmacist-shifts POST' ||
        route.name === 'pharmacist-shifts/bulk POST' ||
        route.name === 'residual-medications POST' ||
        route.name === 'visit-records POST' ||
        route.name === 'set-plans POST' ||
        route.name === 'set-plans/[id]/generate-batches POST' ||
        route.name === 'set-batches POST' ||
        route.name === 'set-audits POST' ||
        route.name === 'dispense-results POST' ||
        route.name === 'dispense-audits POST'
      ) {
        expectSensitiveNoStore(response);
      }
    });

    it(`${route.name} returns 400 for invalid body`, async () => {
      authMock.mockResolvedValue({ user: { id: 'user_1' } });
      membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

      const response = await route.handler(
        createRequest({ 'x-org-id': 'org_1' }, route.invalidBody ?? {}),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(route.invalidBodyStatus ?? 400);
      if (
        route.name === 'cases POST' ||
        route.name === 'visit-preparations/brief-batch POST' ||
        route.name === 'prescription-intakes/facility-batch POST' ||
        route.name === 'communication-requests/[id]/responses POST' ||
        route.name === 'care-reports POST' ||
        route.name === 'inquiry-records POST' ||
        route.name === 'incident-reports POST' ||
        route.name === 'pca-pumps POST' ||
        route.name === 'pca-pump-rentals POST' ||
        route.name === 'consent-records POST' ||
        route.name === 'comments POST' ||
        route.name === 'cds/check POST' ||
        route.name === 'first-visit-documents/print-batch POST' ||
        route.name === 'first-visit-documents POST' ||
        route.name === 'patient-self-reports POST' ||
        route.name === 'medication-profiles POST' ||
        route.name === 'medication-issues POST' ||
        route.name === 'conference-notes/[id]/generate-report POST' ||
        route.name === 'conference-notes/[id]/tasks POST' ||
        route.name === 'document-delivery-rules POST' ||
        route.name === 'tasks POST' ||
        route.name === 'pharmacists POST' ||
        route.name === 'pharmacist-shifts POST' ||
        route.name === 'pharmacist-shifts/bulk POST' ||
        route.name === 'residual-medications POST' ||
        route.name === 'visit-records POST' ||
        route.name === 'set-plans POST' ||
        route.name === 'set-plans/[id]/generate-batches POST' ||
        route.name === 'set-batches POST' ||
        route.name === 'set-audits POST' ||
        route.name === 'dispense-results POST' ||
        route.name === 'dispense-audits POST'
      ) {
        expectSensitiveNoStore(response);
      }
    });

    if (route.successBody) {
      it(`${route.name} returns 200 when role has permission`, async () => {
        authMock.mockResolvedValue({ user: { id: 'user_1' } });
        membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

        const response = await route.handler(
          createRequest({ 'x-org-id': 'org_1' }, route.successBody ?? {}),
        );

        if (!response) throw new Error('response is required');
        expect(response.status).toBe(200);
      });
    }
  }
});
