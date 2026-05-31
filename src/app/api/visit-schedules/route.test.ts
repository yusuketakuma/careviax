import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  pharmacistShiftFindFirstMock,
  visitScheduleFindManyMock,
  visitScheduleFindFirstMock,
  careCaseFindFirstMock,
  validateOrgReferencesMock,
  evaluateVisitWorkflowGateMock,
  visitScheduleCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  pharmacistShiftFindFirstMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
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
    pharmacistShift: {
      findFirst: pharmacistShiftFindFirstMock,
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
  if (body === undefined) {
    return new NextRequest(url, {
      headers: { 'x-org-id': 'org_1' },
    });
  }
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
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
        schedule_status: 'ready',
        scheduled_date: new Date('2026-03-30T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T09:00:00.000Z'),
        time_window_end: new Date('1970-01-01T10:00:00.000Z'),
        priority: 'urgent',
        assignment_mode: 'fallback',
        route_order: 2,
        facility_batch_id: null,
        confirmed_at: new Date('2026-03-29T09:00:00.000Z'),
        carry_items_status: 'ready',
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
    pharmacistShiftFindFirstMock.mockResolvedValue(null);
    visitScheduleFindFirstMock.mockResolvedValue(null);
    careCaseFindFirstMock.mockResolvedValue({
      patient_id: 'patient_1',
      primary_pharmacist_id: 'user_2',
      backup_pharmacist_id: 'user_1',
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
          findFirst: visitScheduleFindFirstMock,
          create: visitScheduleCreateMock,
        },
      }),
    );
  });

  it('lists visit schedules with workload and facility hints', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/visit-schedules?patient_id=patient_1'),
    ))!;

    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload).toMatchObject({
      data: [
        expect.objectContaining({
          id: 'schedule_1',
          pharmacist_id: 'user_2',
          schedule_status: 'ready',
          priority: 'urgent',
          route_order: 2,
          confirmed_at: '2026-03-29T09:00:00.000Z',
          case_: expect.objectContaining({
            patient: expect.objectContaining({
              id: 'patient_1',
              name: '患者A',
            }),
          }),
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
    expect(payload).toMatchSnapshot();
  });

  it('supports the active schedule scope filter', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/visit-schedules?status_scope=active'),
    ))!;

    expect(response.status).toBe(200);
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          schedule_status: {
            in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
          },
          AND: [
            {
              OR: [
                { pharmacist_id: 'user_1' },
                { case_: { primary_pharmacist_id: 'user_1' } },
                { case_: { backup_pharmacist_id: 'user_1' } },
              ],
            },
          ],
        }),
      }),
    );
  });

  it('does not add assignment filters for admin schedule listing', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = (await GET(
      createRequest('http://localhost/api/visit-schedules?status_scope=active'),
    ))!;

    expect(response.status).toBe(200);
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({
          AND: expect.anything(),
        }),
      }),
    );
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
      }),
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
        route_order: 1,
      }),
    });
  });

  it('uses the pharmacist shift site and appends route order when creating a schedule', async () => {
    pharmacistShiftFindFirstMock.mockResolvedValueOnce({
      site_id: 'shift_site_1',
      available: true,
      available_from: new Date('1970-01-01T08:30:00'),
      available_to: new Date('1970-01-01T17:30:00'),
    });
    visitScheduleFindFirstMock.mockResolvedValueOnce({ route_order: 3 });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      case_id: 'case_1',
      pharmacist_id: 'user_2',
      site_id: 'shift_site_1',
    });
    expect(visitScheduleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        site_id: 'shift_site_1',
        route_order: 4,
      }),
    });
  });

  it('rejects visit schedule creation for an unassigned non-admin user', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce({
      patient_id: 'patient_1',
      primary_pharmacist_id: 'primary_user',
      backup_pharmacist_id: 'backup_user',
    });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        site_id: 'site_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'other_user',
        time_window_start: '09:00',
        time_window_end: '10:00',
      }),
    ))!;

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });

  it('allows admin visit schedule creation even when not assigned to the case', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    careCaseFindFirstMock.mockResolvedValueOnce({
      patient_id: 'patient_1',
      primary_pharmacist_id: 'primary_user',
      backup_pharmacist_id: 'backup_user',
    });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        site_id: 'site_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'other_user',
        time_window_start: '09:00',
        time_window_end: '10:00',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(visitScheduleCreateMock).toHaveBeenCalled();
  });

  it('rejects schedules outside an explicit pharmacist shift window', async () => {
    pharmacistShiftFindFirstMock.mockResolvedValueOnce({
      site_id: 'shift_site_1',
      available: true,
      available_from: new Date('1970-01-01T09:30:00'),
      available_to: new Date('1970-01-01T17:30:00'),
    });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '訪問開始時刻が薬剤師シフトの開始前です',
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed visit time windows before service-side schedule creation', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '9:00',
        time_window_end: '10:00',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        time_window_start: ['時刻形式が不正です（HH:mm）'],
      },
    });
    expect(pharmacistShiftFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported visit schedule notes instead of dropping them silently', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        notes: '玄関前で連絡',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '訪問予定メモはまだ保存できません',
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });
});
