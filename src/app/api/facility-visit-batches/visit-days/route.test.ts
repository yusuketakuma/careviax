import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { withAuthMock, withOrgContextMock } = vi.hoisted(() => ({
  withAuthMock: vi.fn(
    (
      handler: (req: NextRequest & { orgId: string; userId: string }) => Promise<Response>
    ) => {
      return (req: NextRequest) =>
        handler({
          ...req,
          orgId: 'org_1',
          userId: 'user_1',
        } as NextRequest & { orgId: string; userId: string });
    }
  ),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/facility-visit-batches/visit-days POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      })
    );

    const response = await POST(
      createRequest({
        facility_label: 'facility_a',
        schedule_ids: ['schedule_1', 'schedule_2'],
        preferred_weekdays: [1, 3],
      })
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
      })
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
      })
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
