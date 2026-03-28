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

describe('/api/facility-visit-batches POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects schedules that span multiple facilities', async () => {
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'schedule_1',
              site_id: 'site_1',
              pharmacist_id: 'ph_1',
              scheduled_date: new Date('2026-03-28T00:00:00Z'),
              facility_batch_id: null,
              case_id: 'case_1',
              preparation: null,
              case_: {
                patient: {
                  id: 'patient_1',
                  name: '山田 太郎',
                  residences: [{ building_id: 'facility_a', address: '東京都港区1-1-1', unit_name: '101' }],
                },
              },
            },
            {
              id: 'schedule_2',
              site_id: 'site_1',
              pharmacist_id: 'ph_1',
              scheduled_date: new Date('2026-03-28T00:00:00Z'),
              facility_batch_id: null,
              case_id: 'case_2',
              preparation: null,
              case_: {
                patient: {
                  id: 'patient_2',
                  name: '山田 花子',
                  residences: [{ building_id: 'facility_b', address: '東京都港区2-2-2', unit_name: '102' }],
                },
              },
            },
          ]),
        },
        facilityVisitBatch: {
          create: vi.fn(),
          update: vi.fn(),
        },
      })
    );

    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1', 'schedule_2'],
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '同一施設の訪問予定のみを一括化できます',
      details: {
        facilities: ['facility_a', 'facility_b'],
      },
    });
  });

  it('creates a facility batch, orders schedules, and bulk-confirms carry items', async () => {
    const batchCreateMock = vi.fn().mockResolvedValue({ id: 'batch_1' });
    const scheduleUpdateMock = vi.fn();
    const preparationUpsertMock = vi.fn();

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'schedule_1',
              site_id: 'site_1',
              pharmacist_id: 'ph_1',
              scheduled_date: new Date('2026-03-28T00:00:00Z'),
              facility_batch_id: null,
              case_id: 'case_1',
              preparation: {
                id: 'prep_1',
                checklist: { carry_items_confirmed: false },
                medication_changes_reviewed: true,
                carry_items_confirmed: false,
                previous_issues_reviewed: true,
                route_confirmed: true,
                offline_synced: true,
                prepared_at: null,
              },
              case_: {
                patient: {
                  id: 'patient_1',
                  name: '山田 太郎',
                  residences: [{ building_id: 'facility_a', address: '東京都港区1-1-1', unit_name: '201' }],
                },
              },
            },
            {
              id: 'schedule_2',
              site_id: 'site_1',
              pharmacist_id: 'ph_1',
              scheduled_date: new Date('2026-03-28T00:00:00Z'),
              facility_batch_id: null,
              case_id: 'case_2',
              preparation: {
                id: 'prep_2',
                checklist: {},
                medication_changes_reviewed: false,
                carry_items_confirmed: false,
                previous_issues_reviewed: false,
                route_confirmed: false,
                offline_synced: false,
                prepared_at: null,
              },
              case_: {
                patient: {
                  id: 'patient_2',
                  name: '山田 花子',
                  residences: [{ building_id: 'facility_a', address: '東京都港区1-1-1', unit_name: '105' }],
                },
              },
            },
          ]),
          update: scheduleUpdateMock,
        },
        facilityVisitBatch: {
          create: batchCreateMock,
          update: vi.fn(),
        },
        visitPreparation: {
          upsert: preparationUpsertMock,
        },
      })
    );

    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1', 'schedule_2'],
        ordered_schedule_ids: ['schedule_2', 'schedule_1'],
        carry_items_confirmed: true,
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      batch_id: 'batch_1',
      facility_label: 'facility_a',
      patient_count: 2,
      carry_items_confirmed: true,
      schedules: [
        {
          schedule_id: 'schedule_2',
          patient_name: '山田 花子',
          unit_name: '105',
          route_order: 1,
        },
        {
          schedule_id: 'schedule_1',
          patient_name: '山田 太郎',
          unit_name: '201',
          route_order: 2,
        },
      ],
    });
    expect(batchCreateMock).toHaveBeenCalledTimes(1);
    expect(scheduleUpdateMock).toHaveBeenCalledTimes(2);
    expect(preparationUpsertMock).toHaveBeenCalledTimes(2);
  });
});
