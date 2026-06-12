import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type TestRouteContext = { params: Promise<Record<string, string>> };

const { notifyWorkflowMutationMock, withAuthContextMock, withOrgContextMock } = vi.hoisted(() => ({
  notifyWorkflowMutationMock: vi.fn(),
  withAuthContextMock: vi.fn(
    (
      handler: (
        req: NextRequest,
        ctx: { orgId: string; userId: string; role: 'pharmacist' },
        routeContext: TestRouteContext,
      ) => Promise<Response>,
    ) => {
      return (req: NextRequest, routeContext: TestRouteContext = { params: Promise.resolve({}) }) =>
        handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
    },
  ),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/facility-visit-batches/visit-days', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  } satisfies NextRequestInit);
}

function createMalformedRequest() {
  return new NextRequest('http://localhost/api/facility-visit-batches/visit-days', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"schedule_ids":',
  } satisfies NextRequestInit);
}

describe('/api/facility-visit-batches/visit-days POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notifyWorkflowMutationMock.mockResolvedValue(undefined);
  });

  it('rejects non-object JSON payloads before schedule lookup, preference upsert, or notification', async () => {
    const response = await POST(createRequest([]));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before schedule lookup, preference upsert, or notification', async () => {
    const response = await POST(createMalformedRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects reversed facility visit day windows before schedule lookup', async () => {
    const response = await POST(
      createRequest({
        facility_label: 'facility_a',
        schedule_ids: ['schedule_1'],
        preferred_weekdays: [1],
        facility_time_from: '15:00',
        facility_time_to: '09:00',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        facility_time_to: ['終了時刻は開始時刻より後にしてください'],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects impossible facility visit day times before schedule lookup', async () => {
    const response = await POST(
      createRequest({
        facility_label: 'facility_a',
        schedule_ids: ['schedule_1'],
        preferred_weekdays: [1],
        preferred_time_from: '24:00',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        preferred_time_from: ['時刻形式が不正です（HH:mm）'],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects reversed preferred visit day windows before schedule lookup', async () => {
    const response = await POST(
      createRequest({
        facility_label: 'facility_a',
        schedule_ids: ['schedule_1'],
        preferred_weekdays: [1],
        preferred_time_from: '14:00',
        preferred_time_to: '10:00',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        preferred_time_to: ['終了時刻は開始時刻より後にしてください'],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects updates when schedules span multiple facilities', async () => {
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'schedule_1',
              case_: {
                patient: {
                  id: 'patient_1',
                  name: '山田 太郎',
                  residences: [{ building_id: 'facility_a', address: '東京都港区1-1-1' }],
                },
              },
            },
            {
              id: 'schedule_2',
              case_: {
                patient: {
                  id: 'patient_2',
                  name: '山田 花子',
                  residences: [{ building_id: 'facility_b', address: '東京都港区2-2-2' }],
                },
              },
            },
          ]),
        },
        patientSchedulePreference: {
          upsert: vi.fn(),
        },
      }),
    );

    const response = await POST(
      createRequest({
        facility_label: 'facility_a',
        schedule_ids: ['schedule_1', 'schedule_2'],
        preferred_weekdays: [1, 3],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '同一訪問先グループの訪問予定のみをまとめて更新できます',
      details: {
        facilities: ['facility_a', 'facility_b'],
      },
    });
  });

  it('bulk-upserts scheduling preferences for all patients in the facility', async () => {
    const upsertMock = vi.fn();

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'schedule_1',
              case_: {
                patient: {
                  id: 'patient_1',
                  name: '山田 太郎',
                  residences: [{ building_id: 'facility_a', address: '東京都港区1-1-1' }],
                },
              },
            },
            {
              id: 'schedule_2',
              case_: {
                patient: {
                  id: 'patient_2',
                  name: '山田 花子',
                  residences: [{ building_id: 'facility_a', address: '東京都港区1-1-1' }],
                },
              },
            },
          ]),
        },
        patientSchedulePreference: {
          upsert: upsertMock,
        },
      }),
    );

    const response = await POST(
      createRequest({
        facility_label: 'facility_a',
        schedule_ids: ['schedule_1', 'schedule_2'],
        preferred_weekdays: [1, 3],
        preferred_time_from: '09:00',
        preferred_time_to: '12:00',
        facility_time_from: '09:30',
        facility_time_to: '15:30',
        visit_buffer_minutes: 30,
        notes: '毎月第1・第3週を優先',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      facility_label: 'facility_a',
      patient_count: 2,
      patient_names: ['山田 太郎', '山田 花子'],
      preferred_weekdays: [1, 3],
      preferred_time_from: '09:00',
      preferred_time_to: '12:00',
      facility_time_from: '09:30',
      facility_time_to: '15:30',
      visit_buffer_minutes: 30,
      notes: '毎月第1・第3週を優先',
    });
    expect(upsertMock).toHaveBeenCalledTimes(2);
    expect(upsertMock).toHaveBeenCalledWith({
      where: {
        patient_id: 'patient_1',
      },
      create: expect.objectContaining({
        org_id: 'org_1',
        patient_id: 'patient_1',
        preferred_weekdays: [1, 3],
      }),
      update: expect.objectContaining({
        facility_time_from: new Date('1970-01-01T09:30'),
        facility_time_to: new Date('1970-01-01T15:30'),
      }),
    });
  });
});
