import { format } from 'date-fns';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withAuthMock,
  withOrgContextMock,
  careCaseFindFirstMock,
  pharmacistShiftFindFirstMock,
  visitScheduleCreateMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => ({
  withAuthMock: vi.fn(
    (
      handler: (
        req: NextRequest & { orgId: string; userId: string; role: string },
      ) => Promise<Response>,
    ) => {
      return (req: NextRequest) =>
        handler(
          Object.assign(req, {
            orgId: 'org_1',
            userId: 'user_1',
            role: 'pharmacist',
          }),
        );
    },
  ),
  withOrgContextMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  pharmacistShiftFindFirstMock: vi.fn(),
  visitScheduleCreateMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
    pharmacistShift: {
      findFirst: pharmacistShiftFindFirstMock,
    },
  },
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/visit-schedules/generate', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/visit-schedules/generate', {
    method: 'POST',
    body: '{"case_id":',
    headers: { 'content-type': 'application/json' },
  });
}

function buildCareCase(overrides?: Record<string, unknown>) {
  return {
    primary_pharmacist_id: 'pharmacist_1',
    backup_pharmacist_id: 'user_1',
    patient: {
      scheduling_preference: {
        preferred_weekdays: [2, 'legacy-debug'],
        preferred_time_from: new Date('1970-01-01T10:00:00'),
        preferred_time_to: new Date('1970-01-01T17:00:00'),
        facility_time_from: new Date('1970-01-01T11:00:00'),
        facility_time_to: new Date('1970-01-01T13:00:00'),
      },
    },
    ...overrides,
  };
}

describe('/api/visit-schedules/generate POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    careCaseFindFirstMock.mockResolvedValue(buildCareCase());
    pharmacistShiftFindFirstMock.mockResolvedValue({ site_id: 'site_1' });
    visitScheduleCreateMock.mockImplementation(async ({ data }) => ({
      id: `schedule_${String(data.scheduled_date)}`,
      ...data,
    }));
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          create: visitScheduleCreateMock,
        },
      }),
    );
  });

  it('generates monthly recurring schedules for multiple ordinal weekdays and intersects patient/facility windows', async () => {
    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=MONTHLY;INTERVAL=1;BYDAY=1TU,3TU',
        start_date: '2026-04-01',
        end_date: '2026-04-30',
        time_window_start: '09:00',
        time_window_end: '12:00',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitScheduleCreateMock).toHaveBeenCalledTimes(2);
    const firstCall = visitScheduleCreateMock.mock.calls[0][0].data;
    const secondCall = visitScheduleCreateMock.mock.calls[1][0].data;
    expect(firstCall.case_id).toBe('case_1');
    expect(format(firstCall.scheduled_date, 'yyyy-MM-dd')).toBe('2026-04-07');
    expect(format(firstCall.time_window_start, 'HH:mm')).toBe('11:00');
    expect(format(firstCall.time_window_end, 'HH:mm')).toBe('12:00');
    expect(firstCall.assignment_mode).toBe('primary');
    expect(format(secondCall.scheduled_date, 'yyyy-MM-dd')).toBe('2026-04-21');
  });

  it('rejects recurrence rules that exceed the weekly insurance limit', async () => {
    careCaseFindFirstMock.mockResolvedValue(
      buildCareCase({
        patient: {
          scheduling_preference: {
            preferred_weekdays: [1, 3],
            preferred_time_from: null,
            preferred_time_to: null,
            facility_time_from: null,
            facility_time_to: null,
          },
        },
      }),
    );

    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE',
        insurance_type: 'medical',
        start_date: '2026-03-30',
        end_date: '2026-04-05',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '週次訪問回数の上限を超えています（医療保険: 週1回まで）',
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects generation for an unassigned non-admin user', async () => {
    careCaseFindFirstMock.mockResolvedValue(
      buildCareCase({
        primary_pharmacist_id: 'primary_user',
        backup_pharmacist_id: 'backup_user',
        patient: {
          scheduling_preference: {
            preferred_weekdays: [2],
            preferred_time_from: null,
            preferred_time_to: null,
            facility_time_from: null,
            facility_time_to: null,
          },
        },
      }),
    );

    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'other_user',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: '2026-04-07',
        end_date: '2026-04-07',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects reversed recurring time windows before loading the case', async () => {
    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: '2026-04-07',
        end_date: '2026-04-07',
        time_window_start: '12:00',
        time_window_end: '11:00',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        time_window_end: ['終了時刻は開始時刻より後にしてください'],
      },
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects invalid recurring date keys before loading the case', async () => {
    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: '2026-02-30',
        end_date: '2026-03-03',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        start_date: ['日付形式が不正です（YYYY-MM-DD）'],
      },
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacistShiftFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects non-object generate payloads before loading the case', async () => {
    const response = await POST(createRequest(['case_1']));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacistShiftFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON generate payloads before loading the case', async () => {
    const response = await POST(createMalformedJsonRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacistShiftFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects schedules when patient and facility windows do not overlap', async () => {
    careCaseFindFirstMock.mockResolvedValue(
      buildCareCase({
        patient: {
          scheduling_preference: {
            preferred_weekdays: [2],
            preferred_time_from: new Date('1970-01-01T09:00:00'),
            preferred_time_to: new Date('1970-01-01T10:00:00'),
            facility_time_from: new Date('1970-01-01T13:00:00'),
            facility_time_to: new Date('1970-01-01T14:00:00'),
          },
        },
      }),
    );

    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: '2026-04-07',
        end_date: '2026-04-07',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '患者在宅時間帯と施設受入時間帯が重ならないため訪問枠を確定できません',
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });
});
