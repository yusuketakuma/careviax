import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  pharmacistShiftFindFirstMock,
  visitScheduleFindManyMock,
  visitScheduleFindFirstMock,
  visitScheduleRouteFindManyMock,
  visitScheduleProposalRouteFindManyMock,
  visitScheduleCountMock,
  visitVehicleResourceFindFirstMock,
  careCaseFindFirstMock,
  validateOrgReferencesMock,
  evaluateVisitWorkflowGateMock,
  visitScheduleCreateMock,
  withOrgContextMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  pharmacistShiftFindFirstMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
  visitScheduleRouteFindManyMock: vi.fn(),
  visitScheduleProposalRouteFindManyMock: vi.fn(),
  visitScheduleCountMock: vi.fn(),
  visitVehicleResourceFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  evaluateVisitWorkflowGateMock: vi.fn(),
  visitScheduleCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
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
      count: visitScheduleCountMock,
    },
    visitVehicleResource: {
      findFirst: visitVehicleResourceFindFirstMock,
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

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function expectUtcTimeDate(value: Date, hhmm: string) {
  expect(value.toISOString()).toBe(`1970-01-01T${hhmm}:00.000Z`);
}

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

function createMalformedJsonPostRequest() {
  return new NextRequest('http://localhost/api/visit-schedules', {
    method: 'POST',
    body: '{"case_id":',
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
        vehicle_resource: {
          id: 'vehicle_1',
          label: '社用車A',
          travel_mode: 'DRIVE',
          max_stops: 8,
          max_route_duration_minutes: 240,
        },
      },
    ]);
    pharmacistShiftFindFirstMock.mockResolvedValue({
      site_id: 'site_1',
      available: true,
      available_from: new Date('1970-01-01T08:30:00.000Z'),
      available_to: new Date('1970-01-01T17:30:00.000Z'),
    });
    visitScheduleFindFirstMock.mockResolvedValue(null);
    visitScheduleRouteFindManyMock.mockResolvedValue([]);
    visitScheduleProposalRouteFindManyMock.mockResolvedValue([]);
    visitScheduleCountMock.mockResolvedValue(0);
    visitVehicleResourceFindFirstMock.mockResolvedValue({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      max_stops: 8,
    });
    careCaseFindFirstMock.mockResolvedValue({
      patient_id: 'patient_1',
      primary_pharmacist_id: 'user_2',
      backup_pharmacist_id: 'user_1',
      patient: {
        scheduling_preference: null,
        residences: [{ facility_unit_id: null, facility: null }],
      },
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
          findMany: visitScheduleRouteFindManyMock,
          create: visitScheduleCreateMock,
        },
        visitScheduleProposal: {
          findMany: visitScheduleProposalRouteFindManyMock,
        },
      }),
    );
  });

  it('lists visit schedules with workload and facility hints', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/visit-schedules?patient_id=patient_1&limit=%201%20'),
    ))!;

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
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
          vehicle_resource: expect.objectContaining({
            id: 'vehicle_1',
            label: '社用車A',
          }),
        }),
      ],
    });
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
      }),
    );
    expect(payload).toMatchSnapshot();
  });

  it('rejects malformed limit values before listing schedules', async () => {
    const response = (await GET(createRequest('http://localhost/api/visit-schedules?limit=10.0')))!;

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'クエリパラメータが不正です',
      details: {
        limit: ['limit は整数で指定してください'],
      },
    });
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects invalid calendar date filters before listing schedules', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/visit-schedules?date_from=2026-02-30'),
    ))!;

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'クエリパラメータが不正です',
      details: {
        date_from: ['日付形式が不正です（YYYY-MM-DD）'],
      },
    });
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when schedule listing fails unexpectedly', async () => {
    visitScheduleFindManyMock.mockRejectedValueOnce(
      new Error('患者 山田太郎 raw visit schedule list facility address'),
    );

    const response = (await GET(createRequest('http://localhost/api/visit-schedules')))!;

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田太郎');
    expect(JSON.stringify(body)).not.toContain('raw visit schedule');
    expect(JSON.stringify(body)).not.toContain('facility address');
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
    const created = visitScheduleCreateMock.mock.calls[0][0].data;
    expectUtcTimeDate(created.time_window_start, '09:00');
    expectUtcTimeDate(created.time_window_end, '10:00');
  });

  it('uses the pharmacist shift site and appends route order when creating a schedule', async () => {
    pharmacistShiftFindFirstMock.mockResolvedValueOnce({
      site_id: 'shift_site_1',
      available: true,
      available_from: new Date('1970-01-01T08:30:00.000Z'),
      available_to: new Date('1970-01-01T17:30:00.000Z'),
    });
    visitScheduleRouteFindManyMock.mockResolvedValueOnce([
      {
        scheduled_date: new Date('2026-03-31'),
        pharmacist_id: 'user_2',
        route_order: 3,
      },
    ]);

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

  it('appends manual schedule route order after open proposals in the same pharmacist day', async () => {
    visitScheduleRouteFindManyMock.mockResolvedValueOnce([]);
    visitScheduleProposalRouteFindManyMock.mockResolvedValueOnce([
      {
        proposed_date: new Date('2026-03-31'),
        proposed_pharmacist_id: 'user_2',
        route_order: 4,
        reschedule_source_schedule_id: null,
      },
    ]);

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
    expect(visitScheduleRouteFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        schedule_status: { notIn: ['cancelled', 'rescheduled'] },
        route_order: { not: null },
        OR: [
          {
            pharmacist_id: 'user_2',
            scheduled_date: new Date('2026-03-31'),
          },
        ],
      },
      select: {
        scheduled_date: true,
        pharmacist_id: true,
        route_order: true,
      },
    });
    expect(visitScheduleProposalRouteFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        finalized_schedule_id: null,
        proposal_status: { in: ['proposed', 'patient_contact_pending', 'reschedule_pending'] },
        route_order: { not: null },
        OR: [
          {
            proposed_pharmacist_id: 'user_2',
            proposed_date: new Date('2026-03-31'),
          },
        ],
      },
      select: {
        proposed_date: true,
        proposed_pharmacist_id: true,
        route_order: true,
        reschedule_source_schedule_id: true,
      },
    });
    expect(visitScheduleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        route_order: 5,
      }),
    });
  });

  it('assigns selected vehicle resources during manual schedule creation', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        site_id: 'site_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
        vehicle_resource_id: 'vehicle_1',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(visitVehicleResourceFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: 'vehicle_1',
        available: true,
      },
      select: {
        id: true,
        site_id: true,
        label: true,
        max_stops: true,
      },
    });
    expect(visitScheduleCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        vehicle_resource_id: 'vehicle_1',
        scheduled_date: new Date('2026-03-31'),
        schedule_status: {
          notIn: ['cancelled', 'rescheduled'],
        },
      },
    });
    expect(visitScheduleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vehicle_resource_id: 'vehicle_1',
      }),
    });
  });

  it('rejects manual schedule creation when the selected vehicle belongs to another site', async () => {
    visitVehicleResourceFindFirstMock.mockResolvedValueOnce({
      id: 'vehicle_2',
      site_id: 'site_2',
      label: '別拠点車両',
      max_stops: 8,
    });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        site_id: 'site_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
        vehicle_resource_id: 'vehicle_2',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '選択した車両リソースは訪問予定の拠点では利用できません',
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects manual schedule creation when the selected vehicle stop limit is exceeded', async () => {
    visitVehicleResourceFindFirstMock.mockResolvedValueOnce({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      max_stops: 1,
    });
    visitScheduleCountMock.mockResolvedValueOnce(1);

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        site_id: 'site_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
        vehicle_resource_id: 'vehicle_1',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '社用車A で訪問できる件数は最大 1 件です',
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });

  it('allows org-wide pharmacist visit schedule creation even when not assigned to the case', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce({
      patient_id: 'patient_1',
      primary_pharmacist_id: 'primary_user',
      backup_pharmacist_id: 'backup_user',
      patient: {
        scheduling_preference: null,
        residences: [{ facility_unit_id: null, facility: null }],
      },
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

  it('allows admin visit schedule creation even when not assigned to the case', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    careCaseFindFirstMock.mockResolvedValueOnce({
      patient_id: 'patient_1',
      primary_pharmacist_id: 'primary_user',
      backup_pharmacist_id: 'backup_user',
      patient: {
        scheduling_preference: null,
        residences: [{ facility_unit_id: null, facility: null }],
      },
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
      available_from: new Date('1970-01-01T09:30:00.000Z'),
      available_to: new Date('1970-01-01T17:30:00.000Z'),
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

  it('rejects manual schedule creation when the selected pharmacist has no shift', async () => {
    pharmacistShiftFindFirstMock.mockResolvedValueOnce(null);

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
      message: '選択した薬剤師のシフトがありません',
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects manual schedule creation outside patient preferred time windows', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce({
      patient_id: 'patient_1',
      primary_pharmacist_id: 'user_2',
      backup_pharmacist_id: 'user_1',
      patient: {
        scheduling_preference: {
          preferred_weekdays: [],
          preferred_time_from: new Date('1970-01-01T10:00:00.000Z'),
          preferred_time_to: new Date('1970-01-01T12:00:00.000Z'),
          facility_time_from: null,
          facility_time_to: null,
        },
        residences: [{ facility_unit_id: null, facility: null }],
      },
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
      message: '訪問開始時刻が患者または施設の希望開始時刻 10:00 より前です',
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects manual schedule creation without a time window when patient preferences define one', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce({
      patient_id: 'patient_1',
      primary_pharmacist_id: 'user_2',
      backup_pharmacist_id: 'user_1',
      patient: {
        scheduling_preference: {
          preferred_weekdays: [],
          preferred_time_from: new Date('1970-01-01T10:00:00.000Z'),
          preferred_time_to: new Date('1970-01-01T12:00:00.000Z'),
          facility_time_from: null,
          facility_time_to: null,
        },
        residences: [{ facility_unit_id: null, facility: null }],
      },
    });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '訪問開始時刻を患者または施設の希望開始時刻 10:00 以降で指定してください',
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects manual schedule creation outside patient preferred weekdays', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce({
      patient_id: 'patient_1',
      primary_pharmacist_id: 'user_2',
      backup_pharmacist_id: 'user_1',
      patient: {
        scheduling_preference: {
          preferred_weekdays: [1],
          preferred_time_from: null,
          preferred_time_to: null,
          facility_time_from: null,
          facility_time_to: null,
        },
        residences: [{ facility_unit_id: null, facility: null }],
      },
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
      message: '患者または施設の訪問希望曜日と一致しない日付です',
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
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

  it.each([
    {
      payload: { time_window_start: '09:00' },
      details: { time_window_end: ['終了時刻も入力してください'] },
    },
    {
      payload: { time_window_end: '10:00' },
      details: { time_window_start: ['開始時刻も入力してください'] },
    },
  ])(
    'rejects incomplete visit time windows before service-side schedule creation',
    async (caseItem) => {
      const response = (await POST(
        createRequest('http://localhost/api/visit-schedules', {
          case_id: 'case_1',
          visit_type: 'regular',
          scheduled_date: '2026-03-31',
          pharmacist_id: 'user_2',
          ...caseItem.payload,
        }),
      ))!;

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        message: '入力値が不正です',
        details: caseItem.details,
      });
      expect(pharmacistShiftFindFirstMock).not.toHaveBeenCalled();
      expect(validateOrgReferencesMock).not.toHaveBeenCalled();
      expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    },
  );

  it('rejects invalid calendar scheduled dates before service-side schedule creation', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        visit_type: 'regular',
        scheduled_date: '2026-02-30',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        scheduled_date: ['日付形式が不正です（YYYY-MM-DD）'],
      },
    });
    expect(pharmacistShiftFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(evaluateVisitWorkflowGateMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects non-object create payloads before schedule service work', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', ['case_1']),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(pharmacistShiftFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(evaluateVisitWorkflowGateMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before schedule service work', async () => {
    const response = (await POST(createMalformedJsonPostRequest()))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(pharmacistShiftFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(evaluateVisitWorkflowGateMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
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
