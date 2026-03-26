import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  prismaMock,
  withOrgContextMock,
  txMock,
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
      }
    );
  };

  type DbProxy = Record<string, ReturnType<typeof createModel>>;

  return {
    authMock: vi.fn(),
    prismaMock: createDbProxy() as DbProxy,
    txMock: createDbProxy() as DbProxy,
    withOrgContextMock: vi.fn(),
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

import { GET as auditLogsGet } from '../audit-logs/route';
import { GET as auditLogsExportGet } from '../audit-logs/export/route';
import { GET as billingCandidatesGet } from '../billing-candidates/route';
import { GET as billingCandidatesExportGet } from '../billing-candidates/export/route';
import { GET as careReportsGet } from '../care-reports/route';
import { GET as careReportGet } from '../care-reports/[id]/route';
import { GET as communicationEventsGet } from '../communication-events/route';
import { GET as communicationRequestsGet } from '../communication-requests/route';
import { GET as conferenceNotesGet } from '../conference-notes/route';
import { GET as dashboardTodayGet } from '../dashboard/today/route';
import { GET as dashboardWorkflowGet } from '../dashboard/workflow/route';
import { GET as dashboardMedicationDeadlinesGet } from '../dashboard/medication-deadlines/route';
import { GET as dispenseAuditsGet } from '../dispense-audits/route';
import { GET as dispenseQueueGet } from '../dispense-queue/route';
import { GET as inquiryRecordsGet } from '../inquiry-records/route';
import { GET as medicationIssuesGet } from '../medication-issues/route';
import { GET as medicationProfilesGet } from '../medication-profiles/route';
import { GET as patientsGet } from '../patients/route';
import { GET as patientGet } from '../patients/[id]/route';
import { GET as pharmacistShiftsGet } from '../pharmacist-shifts/route';
import { GET as pharmacistShiftsAvailableGet } from '../pharmacist-shifts/available/route';
import { GET as prescriptionIntakesGet } from '../prescription-intakes/route';
import { GET as prescriptionIntakeGet } from '../prescription-intakes/[id]/route';
import { GET as residualMedicationsGet } from '../residual-medications/route';
import { GET as setPlansGet } from '../set-plans/route';
import { GET as tracingReportsGet } from '../tracing-reports/route';
import { GET as visitRecordsGet } from '../visit-records/route';
import { GET as visitRecordGet } from '../visit-records/[id]/route';
import { GET as visitSchedulesGet } from '../visit-schedules/route';
import { GET as visitScheduleGet } from '../visit-schedules/[id]/route';
import { GET as visitSchedulesTodayGet } from '../visit-schedules/today/route';

type Handler = () => Promise<Response | undefined>;

function createRequest(url: string, headers?: Record<string, string>) {
  const nextUrl = new URL(url);
  return {
    url,
    nextUrl,
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
  } as unknown as NextRequest;
}

const routes: Array<{ name: string; handler: Handler }> = [
  {
    name: 'audit-logs GET',
    handler: () => auditLogsGet(createRequest('http://localhost/api/audit-logs', { 'x-org-id': 'org_1' })),
  },
  {
    name: 'audit-logs/export GET',
    handler: () => auditLogsExportGet(createRequest('http://localhost/api/audit-logs/export', { 'x-org-id': 'org_1' })),
  },
  {
    name: 'billing-candidates GET',
    handler: () => billingCandidatesGet(createRequest('http://localhost/api/billing-candidates', { 'x-org-id': 'org_1' })),
  },
  {
    name: 'billing-candidates/export GET',
    handler: () => billingCandidatesExportGet(createRequest('http://localhost/api/billing-candidates/export', { 'x-org-id': 'org_1' })),
  },
  {
    name: 'care-reports GET',
    handler: () => careReportsGet(createRequest('http://localhost/api/care-reports', { 'x-org-id': 'org_1' })),
  },
  {
    name: 'care-reports/[id] GET',
    handler: () => careReportGet(createRequest('http://localhost/api/care-reports/report_1', { 'x-org-id': 'org_1' }), { params: Promise.resolve({ id: 'report_1' }) }),
  },
  {
    name: 'communication-events GET',
    handler: () => communicationEventsGet(createRequest('http://localhost/api/communication-events', { 'x-org-id': 'org_1' })),
  },
  {
    name: 'communication-requests GET',
    handler: () => communicationRequestsGet(createRequest('http://localhost/api/communication-requests', { 'x-org-id': 'org_1' })),
  },
  {
    name: 'conference-notes GET',
    handler: () => conferenceNotesGet(createRequest('http://localhost/api/conference-notes', { 'x-org-id': 'org_1' })),
  },
  {
    name: 'dashboard/today GET',
    handler: () => dashboardTodayGet(createRequest('http://localhost/api/dashboard/today', { 'x-org-id': 'org_1' })),
  },
  {
    name: 'dashboard/workflow GET',
    handler: () => dashboardWorkflowGet(createRequest('http://localhost/api/dashboard/workflow', { 'x-org-id': 'org_1' })),
  },
  {
    name: 'dashboard/medication-deadlines GET',
    handler: () => dashboardMedicationDeadlinesGet(createRequest('http://localhost/api/dashboard/medication-deadlines', { 'x-org-id': 'org_1' })),
  },
  {
    name: 'dispense-audits GET',
    handler: () => dispenseAuditsGet(createRequest('http://localhost/api/dispense-audits', { 'x-org-id': 'org_1' })),
  },
  {
    name: 'dispense-queue GET',
    handler: () => dispenseQueueGet(createRequest('http://localhost/api/dispense-queue', { 'x-org-id': 'org_1' })),
  },
  {
    name: 'inquiry-records GET',
    handler: () => inquiryRecordsGet(createRequest('http://localhost/api/inquiry-records', { 'x-org-id': 'org_1' })),
  },
  {
    name: 'medication-issues GET',
    handler: () => medicationIssuesGet(createRequest('http://localhost/api/medication-issues', { 'x-org-id': 'org_1' })),
  },
  {
    name: 'medication-profiles GET',
    handler: () => medicationProfilesGet(createRequest('http://localhost/api/medication-profiles', { 'x-org-id': 'org_1' })),
  },
  {
    name: 'patients GET',
    handler: () => patientsGet(createRequest('http://localhost/api/patients', { 'x-org-id': 'org_1' })),
  },
  {
    name: 'patients/[id] GET',
    handler: () => patientGet(createRequest('http://localhost/api/patients/patient_1', { 'x-org-id': 'org_1' }), { params: Promise.resolve({ id: 'patient_1' }) }),
  },
  {
    name: 'pharmacist-shifts GET',
    handler: () => pharmacistShiftsGet(createRequest('http://localhost/api/pharmacist-shifts', { 'x-org-id': 'org_1' })),
  },
  {
    name: 'pharmacist-shifts/available GET',
    handler: () => pharmacistShiftsAvailableGet(createRequest('http://localhost/api/pharmacist-shifts/available?date=2026-03-26', { 'x-org-id': 'org_1' })),
  },
  {
    name: 'prescription-intakes GET',
    handler: () => prescriptionIntakesGet(createRequest('http://localhost/api/prescription-intakes', { 'x-org-id': 'org_1' })),
  },
  {
    name: 'prescription-intakes/[id] GET',
    handler: () => prescriptionIntakeGet(createRequest('http://localhost/api/prescription-intakes/intake_1', { 'x-org-id': 'org_1' }), { params: Promise.resolve({ id: 'intake_1' }) }),
  },
  {
    name: 'residual-medications GET',
    handler: () => residualMedicationsGet(createRequest('http://localhost/api/residual-medications', { 'x-org-id': 'org_1' })),
  },
  {
    name: 'set-plans GET',
    handler: () => setPlansGet(createRequest('http://localhost/api/set-plans', { 'x-org-id': 'org_1' })),
  },
  {
    name: 'tracing-reports GET',
    handler: () => tracingReportsGet(createRequest('http://localhost/api/tracing-reports', { 'x-org-id': 'org_1' })),
  },
  {
    name: 'visit-records GET',
    handler: () => visitRecordsGet(createRequest('http://localhost/api/visit-records', { 'x-org-id': 'org_1' })),
  },
  {
    name: 'visit-records/[id] GET',
    handler: () => visitRecordGet(createRequest('http://localhost/api/visit-records/record_1', { 'x-org-id': 'org_1' }), { params: Promise.resolve({ id: 'record_1' }) }),
  },
  {
    name: 'visit-schedules GET',
    handler: () => visitSchedulesGet(createRequest('http://localhost/api/visit-schedules', { 'x-org-id': 'org_1' })),
  },
  {
    name: 'visit-schedules/[id] GET',
    handler: () => visitScheduleGet(createRequest('http://localhost/api/visit-schedules/schedule_1', { 'x-org-id': 'org_1' }), { params: Promise.resolve({ id: 'schedule_1' }) }),
  },
  {
    name: 'visit-schedules/today GET',
    handler: () => visitSchedulesTodayGet(createRequest('http://localhost/api/visit-schedules/today', { 'x-org-id': 'org_1' })),
  },
];

describe('protected GET routes auth matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback(txMock)
    );
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
