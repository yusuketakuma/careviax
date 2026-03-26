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
    proposal_status: 'proposed',
    proposed_pharmacist_id: 'user_1',
    proposed_date: new Date('2026-03-26T00:00:00.000Z'),
    time_window_start: new Date('1970-01-01T09:00:00.000Z'),
    time_window_end: new Date('1970-01-01T10:00:00.000Z'),
    visit_type: 'regular',
    priority: 'normal',
    assignment_mode: 'primary',
    route_order: 1,
    medication_end_date: null,
    visit_deadline_date: null,
    escalation_reason: null,
    finalized_schedule_id: null,
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

import { PATCH as casePatch } from '../cases/[id]/route';
import { PATCH as caseTransitionPatch } from '../cases/[id]/transition/route';
import { PATCH as careReportPatch } from '../care-reports/[id]/route';
import { PATCH as communicationRequestPatch } from '../communication-requests/[id]/route';
import { PATCH as inquiryRecordPatch } from '../inquiry-records/[id]/route';
import { PATCH as medicationCycleTransitionPatch } from '../medication-cycles/[id]/transition/route';
import { PATCH as medicationIssuePatch } from '../medication-issues/[id]/route';
import { PATCH as billingCandidatePatch } from '../billing-candidates/[id]/route';
import { PATCH as notificationsPatch } from '../notifications/route';
import { PATCH as patientPatch } from '../patients/[id]/route';
import { PATCH as prescriptionIntakePatch } from '../prescription-intakes/[id]/route';
import { PATCH as visitRecordPatch } from '../visit-records/[id]/route';
import { PATCH as visitScheduleProposalPatch } from '../visit-schedule-proposals/[id]/route';
import { PATCH as visitSchedulePatch, DELETE as visitScheduleDelete } from '../visit-schedules/[id]/route';

type Handler = () => Promise<Response | undefined>;
type RouteEntry = { name: string; handler: Handler; successBody?: unknown };

function createRequest(
  url: string,
  headers?: Record<string, string>,
  body?: unknown
) {
  return {
    url,
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
    json: vi.fn().mockResolvedValue(body ?? {}),
  } as unknown as NextRequest;
}

const permissionRoutes: RouteEntry[] = [
  {
    name: 'cases/[id] PATCH',
    handler: () => casePatch(createRequest('http://localhost/api/cases/case_1', { 'x-org-id': 'org_1' }, {}), { params: Promise.resolve({ id: 'case_1' }) }),
  },
  {
    name: 'cases/[id]/transition PATCH',
    handler: () => caseTransitionPatch(createRequest('http://localhost/api/cases/case_1/transition', { 'x-org-id': 'org_1' }, { from: 'active', to: 'on_hold' }), { params: Promise.resolve({ id: 'case_1' }) }),
  },
  {
    name: 'care-reports/[id] PATCH',
    handler: () => careReportPatch(createRequest('http://localhost/api/care-reports/report_1', { 'x-org-id': 'org_1' }, {}), { params: Promise.resolve({ id: 'report_1' }) }),
  },
  {
    name: 'billing-candidates/[id] PATCH',
    handler: () =>
      billingCandidatePatch(
        createRequest('http://localhost/api/billing-candidates/candidate_1', { 'x-org-id': 'org_1' }, { action: 'confirm' }),
        { params: Promise.resolve({ id: 'candidate_1' }) }
      ),
    successBody: { action: 'confirm' },
  },
  {
    name: 'communication-requests/[id] PATCH',
    handler: () => communicationRequestPatch(createRequest('http://localhost/api/communication-requests/request_1', { 'x-org-id': 'org_1' }, {}), { params: Promise.resolve({ id: 'request_1' }) }),
  },
  {
    name: 'inquiry-records/[id] PATCH',
    handler: () => inquiryRecordPatch(createRequest('http://localhost/api/inquiry-records/inquiry_1', { 'x-org-id': 'org_1' }, {}), { params: Promise.resolve({ id: 'inquiry_1' }) }),
  },
  {
    name: 'medication-cycles/[id]/transition PATCH',
    handler: () => medicationCycleTransitionPatch(createRequest('http://localhost/api/medication-cycles/cycle_1/transition', { 'x-org-id': 'org_1' }, { to: 'dispensing', version: 1 }), { params: Promise.resolve({ id: 'cycle_1' }) }),
  },
  {
    name: 'medication-issues/[id] PATCH',
    handler: () => medicationIssuePatch(createRequest('http://localhost/api/medication-issues/issue_1', { 'x-org-id': 'org_1' }, {}), { params: Promise.resolve({ id: 'issue_1' }) }),
  },
  {
    name: 'patients/[id] PATCH',
    handler: () => patientPatch(createRequest('http://localhost/api/patients/patient_1', { 'x-org-id': 'org_1' }, {}), { params: Promise.resolve({ id: 'patient_1' }) }),
  },
  {
    name: 'prescription-intakes/[id] PATCH',
    handler: () => prescriptionIntakePatch(createRequest('http://localhost/api/prescription-intakes/intake_1', { 'x-org-id': 'org_1' }, {}), { params: Promise.resolve({ id: 'intake_1' }) }),
  },
  {
    name: 'visit-records/[id] PATCH',
    handler: () => visitRecordPatch(createRequest('http://localhost/api/visit-records/record_1', { 'x-org-id': 'org_1' }, { version: 1 }), { params: Promise.resolve({ id: 'record_1' }) }),
  },
  {
    name: 'visit-schedule-proposals/[id] PATCH',
    handler: () => visitScheduleProposalPatch(createRequest('http://localhost/api/visit-schedule-proposals/proposal_1', { 'x-org-id': 'org_1' }, { action: 'approve' }), { params: Promise.resolve({ id: 'proposal_1' }) }),
  },
  {
    name: 'visit-schedules/[id] PATCH',
    handler: () => visitSchedulePatch(createRequest('http://localhost/api/visit-schedules/schedule_1', { 'x-org-id': 'org_1' }, {}), { params: Promise.resolve({ id: 'schedule_1' }) }),
  },
  {
    name: 'visit-schedules/[id] DELETE',
    handler: () => visitScheduleDelete(createRequest('http://localhost/api/visit-schedules/schedule_1', { 'x-org-id': 'org_1' }), { params: Promise.resolve({ id: 'schedule_1' }) }),
  },
];

describe('protected PATCH/DELETE routes auth matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback(txMock)
    );
  });

  for (const route of permissionRoutes) {
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

  it('notifications PATCH returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const response = await notificationsPatch(
      createRequest('http://localhost/api/notifications', { 'x-org-id': 'org_1' }, { all: true })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
  });

  it('notifications PATCH returns 200 when authenticated', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });

    const response = await notificationsPatch(
      createRequest('http://localhost/api/notifications', { 'x-org-id': 'org_1' }, { all: true })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
  });
});
