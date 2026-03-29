import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  visitScheduleFindManyMock,
  careCaseFindFirstMock,
  validateOrgReferencesMock,
  evaluateVisitWorkflowGateMock,
  visitScheduleCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  evaluateVisitWorkflowGateMock: vi.fn(),
  visitScheduleCreateMock: vi.fn(),
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
    visitSchedule: {
      findMany: visitScheduleFindManyMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
  },
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/server/services/management-plans', () => ({
  evaluateVisitWorkflowGate: evaluateVisitWorkflowGateMock,
  formatVisitWorkflowGateIssues: (issues: string[]) => issues.join(','),
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

function createRequest(url: string, body?: unknown) {
  return {
    url,
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
    },
    nextUrl: new URL(url),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe('/api/visit-schedules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    visitScheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        org_id: 'org_1',
        pharmacist_id: 'user_2',
        scheduled_date: new Date('2026-03-30T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T09:00:00.000Z'),
        priority: 'urgent',
        assignment_mode: 'fallback',
        visit_record: null,
        facility_batch: null,
        preparation: null,
        override_request: null,
        applied_override: null,
        case_: {
          patient: {
            id: 'patient_1',
            name: '患者A',
            residences: [{ address: '施設A', building_id: 'facility_1' }],
          },
        },
        cycle: { overall_status: 'visit_ready' },
        site: { id: 'site_1', name: '本店', address: '東京都', lat: 35, lng: 139 },
      },
    ]);
    careCaseFindFirstMock.mockResolvedValue({
      patient_id: 'patient_1',
      primary_pharmacist_id: 'user_2',
    });
    validateOrgReferencesMock.mockResolvedValue({ ok: true });
    evaluateVisitWorkflowGateMock.mockResolvedValue({ ok: true, issues: [] });
    visitScheduleCreateMock.mockResolvedValue({
      id: 'schedule_2',
      assignment_mode: 'primary',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          create: visitScheduleCreateMock,
        },
      }),
    );
  });

  it('lists visit schedules with workload and facility hints', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/visit-schedules?patient_id=patient_1')
    ))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 'schedule_1',
          facility_hint: null,
          handoff_hint: expect.objectContaining({
            summary: expect.stringContaining('代替担当'),
          }),
          workload_hint: expect.objectContaining({
            daily_visit_count: 1,
          }),
        }),
      ],
    });
  });

  it('creates a visit schedule after gate and reference checks', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        site_id: 'site_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
      })
    ))!;

    expect(response.status).toBe(201);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      case_id: 'case_1',
      pharmacist_id: 'user_2',
      site_id: 'site_1',
    });
    expect(evaluateVisitWorkflowGateMock).toHaveBeenCalled();
    expect(visitScheduleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        case_id: 'case_1',
        pharmacist_id: 'user_2',
        assignment_mode: 'primary',
        confirmed_by: 'user_1',
      }),
    });
  });
});
