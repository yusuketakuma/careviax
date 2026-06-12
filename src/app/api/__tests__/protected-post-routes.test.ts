import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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
import { POST as medicationProfilesPost } from '../medication-profiles/route';
import { POST as medicationIssuesPost } from '../medication-issues/route';
import { POST as communicationEventsPost } from '../communication-events/route';
import { POST as communicationRequestsPost } from '../communication-requests/route';
import { POST as conferenceNotesPost } from '../conference-notes/route';
import { POST as careReportsPost } from '../care-reports/route';
import { POST as tracingReportsPost } from '../tracing-reports/route';
import { POST as visitSchedulesPost } from '../visit-schedules/route';
import { POST as visitSchedulesGeneratePost } from '../visit-schedules/generate/route';
import { POST as visitRecordsPost } from '../visit-records/route';
import { POST as prescriptionIntakesPost } from '../prescription-intakes/route';
import { POST as pharmacistShiftsPost } from '../pharmacist-shifts/route';
import { POST as setPlansPost } from '../set-plans/route';
import { POST as setAuditsPost } from '../set-audits/route';
import { POST as dispenseAuditsPost } from '../dispense-audits/route';
import { POST as dispenseResultsPost } from '../dispense-results/route';
import { POST as inquiryRecordsPost } from '../inquiry-records/route';
import { POST as residualMedicationsPost } from '../residual-medications/route';
import { POST as billingCandidatesPost } from '../billing-candidates/route';
import { POST as billingCandidatesClosePost } from '../billing-candidates/close/route';
import { POST as businessHolidaysPost } from '../business-holidays/route';
import { POST as cdsCheckPost } from '../cds/check/route';
import { POST as pharmacistsPost } from '../pharmacists/route';
import { POST as visitScheduleProposalsPost } from '../visit-schedule-proposals/route';
import { POST as visitPreparationBriefBatchPost } from '../visit-preparations/brief-batch/route';
import { POST as visitSchedulesReschedulePost } from '../visit-schedules/[id]/reschedule/route';
import { POST as collaborationRoomTokenPost } from '../collaboration/room-token/route';

type Handler = (req: NextRequest) => Promise<Response | undefined>;
type RouteEntry = { name: string; handler: Handler; successBody?: unknown };
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
  {
    name: 'medication-profiles POST',
    handler: (req) => medicationProfilesPost(req, emptyRouteContext),
  },
  {
    name: 'medication-issues POST',
    handler: (req) => medicationIssuesPost(req, emptyRouteContext),
  },
  {
    name: 'communication-events POST',
    handler: (req) => communicationEventsPost(req, emptyRouteContext),
  },
  {
    name: 'communication-requests POST',
    handler: (req) => communicationRequestsPost(req, emptyRouteContext),
  },
  { name: 'conference-notes POST', handler: (req) => conferenceNotesPost(req, emptyRouteContext) },
  { name: 'care-reports POST', handler: (req) => careReportsPost(req, emptyRouteContext) },
  { name: 'tracing-reports POST', handler: (req) => tracingReportsPost(req, emptyRouteContext) },
  { name: 'visit-schedules POST', handler: (req) => visitSchedulesPost(req, emptyRouteContext) },
  {
    name: 'visit-schedules/generate POST',
    handler: (req) => visitSchedulesGeneratePost(req, emptyRouteContext),
  },
  { name: 'visit-records POST', handler: (req) => visitRecordsPost(req, emptyRouteContext) },
  {
    name: 'prescription-intakes POST',
    handler: (req) => prescriptionIntakesPost(req, emptyRouteContext),
  },
  {
    name: 'pharmacist-shifts POST',
    handler: (req) => pharmacistShiftsPost(req, emptyRouteContext),
  },
  { name: 'set-plans POST', handler: (req) => setPlansPost(req, emptyRouteContext) },
  { name: 'set-audits POST', handler: (req) => setAuditsPost(req, emptyRouteContext) },
  { name: 'dispense-audits POST', handler: (req) => dispenseAuditsPost(req, emptyRouteContext) },
  { name: 'dispense-results POST', handler: (req) => dispenseResultsPost(req, emptyRouteContext) },
  { name: 'inquiry-records POST', handler: (req) => inquiryRecordsPost(req, emptyRouteContext) },
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
    name: 'business-holidays POST',
    handler: (req) => businessHolidaysPost(req, emptyRouteContext),
  },
  { name: 'cds/check POST', handler: (req) => cdsCheckPost(req, emptyRouteContext) },
  { name: 'pharmacists POST', handler: (req) => pharmacistsPost(req, emptyRouteContext) },
  {
    name: 'visit-schedule-proposals POST',
    handler: (req) => visitScheduleProposalsPost(req, emptyRouteContext),
  },
  { name: 'visit-preparations/brief-batch POST', handler: visitPreparationBriefBatchPost },
  { name: 'collaboration/room-token POST', handler: collaborationRoomTokenPost },
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
    });

    it(`${route.name} returns 403 when role lacks permission`, async () => {
      authMock.mockResolvedValue({ user: { id: 'user_1' } });
      membershipFindFirstMock.mockResolvedValue({ role: 'driver' });

      const response = await route.handler(createRequest({ 'x-org-id': 'org_1' }, {}));

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(403);
    });

    it(`${route.name} returns 400 for invalid body`, async () => {
      authMock.mockResolvedValue({ user: { id: 'user_1' } });
      membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

      const response = await route.handler(createRequest({ 'x-org-id': 'org_1' }, {}));

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
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
