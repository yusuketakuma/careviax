import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { authMock, membershipFindFirstMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
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
import { POST as cdsCheckPost } from '../cds/check/route';

type Handler = (req: NextRequest) => Promise<Response>;

function createRequest(headers?: Record<string, string>, body: unknown = {}) {
  return {
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

const routes: Array<{ name: string; handler: Handler }> = [
  { name: 'cases POST', handler: casesPost },
  { name: 'patients POST', handler: patientsPost },
  { name: 'medication-profiles POST', handler: medicationProfilesPost },
  { name: 'medication-issues POST', handler: medicationIssuesPost },
  { name: 'communication-events POST', handler: communicationEventsPost },
  { name: 'communication-requests POST', handler: communicationRequestsPost },
  { name: 'conference-notes POST', handler: conferenceNotesPost },
  { name: 'care-reports POST', handler: careReportsPost },
  { name: 'tracing-reports POST', handler: tracingReportsPost },
  { name: 'visit-schedules POST', handler: visitSchedulesPost },
  { name: 'visit-schedules/generate POST', handler: visitSchedulesGeneratePost },
  { name: 'visit-records POST', handler: visitRecordsPost },
  { name: 'prescription-intakes POST', handler: prescriptionIntakesPost },
  { name: 'pharmacist-shifts POST', handler: pharmacistShiftsPost },
  { name: 'set-plans POST', handler: setPlansPost },
  { name: 'set-audits POST', handler: setAuditsPost },
  { name: 'dispense-audits POST', handler: dispenseAuditsPost },
  { name: 'dispense-results POST', handler: dispenseResultsPost },
  { name: 'inquiry-records POST', handler: inquiryRecordsPost },
  { name: 'residual-medications POST', handler: residualMedicationsPost },
  { name: 'billing-candidates POST', handler: billingCandidatesPost },
  { name: 'cds/check POST', handler: cdsCheckPost },
];

describe('protected POST routes auth/body matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  for (const route of routes) {
    it(`${route.name} returns 401 when unauthenticated`, async () => {
      authMock.mockResolvedValue(null);

      const response = await route.handler(
        createRequest({ 'x-org-id': 'org_1' }, {})
      );

      expect(response.status).toBe(401);
    });

    it(`${route.name} returns 403 when role lacks permission`, async () => {
      authMock.mockResolvedValue({ user: { id: 'user_1' } });
      membershipFindFirstMock.mockResolvedValue({ role: 'driver' });

      const response = await route.handler(
        createRequest({ 'x-org-id': 'org_1' }, {})
      );

      expect(response.status).toBe(403);
    });

    it(`${route.name} returns 400 for invalid body`, async () => {
      authMock.mockResolvedValue({ user: { id: 'user_1' } });
      membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

      const response = await route.handler(
        createRequest({ 'x-org-id': 'org_1' }, {})
      );

      expect(response.status).toBe(400);
    });
  }
});
